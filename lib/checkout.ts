import { db } from "./store";
import { stubPaymentProvider, type PaymentProvider } from "./payments";
import type {
  CheckoutSession,
  Listing,
  PaymentOutcome,
  SessionView,
  Surface,
} from "./types";

export const HOLD_TTL_MS = 5 * 60 * 1000;

export type ErrorCode =
  | "NOT_FOUND"
  | "SOLD_OUT"
  | "SESSION_EXPIRED"
  | "PRICE_CHANGED"
  | "PAYMENT_IN_PROGRESS"
  | "INVALID";

export class CheckoutError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public httpStatus: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function track(name: string, props: Record<string, string | number | boolean> = {}) {
  db.events.push({ at: Date.now(), name, props });
}

function availableQty(listing: Listing): number {
  return listing.totalQty - listing.heldQty - listing.soldQty;
}

function getListingOrThrow(listingId: string): Listing {
  const listing = db.listings.get(listingId);
  if (!listing) throw new CheckoutError("NOT_FOUND", "Listing not found", 404);
  return listing;
}

function getSessionOrThrow(sessionId: string): CheckoutSession {
  const session = db.sessions.get(sessionId);
  if (!session) throw new CheckoutError("NOT_FOUND", "Session not found", 404);
  return session;
}

/**
 * Expiry is evaluated lazily on every read/mutation rather than with timers:
 * the stored deadline is the source of truth, so all surfaces converge on the
 * same answer no matter when they ask. Only an active hold can expire; a
 * session that is mid-payment is protected until the payment settles.
 */
function expireIfNeeded(session: CheckoutSession, now = Date.now()): void {
  if (session.status !== "active" || now <= session.holdExpiresAt) return;
  const listing = db.listings.get(session.listingId);
  if (listing) listing.heldQty = Math.max(0, listing.heldQty - session.quantity);
  session.status = "expired";
  session.version++;
  track("session_expired", { sessionId: session.id });
}

export function buildView(session: CheckoutSession): SessionView {
  const listing = getListingOrThrow(session.listingId);
  const now = Date.now();
  return {
    session,
    listing: {
      id: listing.id,
      eventName: listing.eventName,
      venue: listing.venue,
      eventDateISO: listing.eventDateISO,
      section: listing.section,
      row: listing.row,
      currentPriceCents: listing.currentPriceCents,
    },
    priceChanged:
      session.status !== "completed" &&
      listing.currentPriceCents !== session.acceptedPriceCents,
    msRemaining:
      session.status === "active" ? Math.max(0, session.holdExpiresAt - now) : 0,
    serverNow: now,
  };
}

export function listListings(): Listing[] {
  return [...db.listings.values()];
}

export function createSession(params: {
  listingId: string;
  quantity?: number;
  surface: Surface;
}): SessionView {
  const { listingId, quantity = 2, surface } = params;
  const listing = getListingOrThrow(listingId);
  if (quantity < 1) throw new CheckoutError("INVALID", "Quantity must be at least 1", 400);
  if (availableQty(listing) < quantity) {
    throw new CheckoutError("SOLD_OUT", "Not enough tickets available", 409);
  }
  listing.heldQty += quantity;
  const now = Date.now();
  const session: CheckoutSession = {
    id: `cs_${crypto.randomUUID().slice(0, 8)}`,
    listingId,
    quantity,
    acceptedPriceCents: listing.currentPriceCents,
    status: "active",
    holdExpiresAt: now + HOLD_TTL_MS,
    version: 1,
    createdAt: now,
    createdSurface: surface,
    lastResumedSurface: surface,
  };
  db.sessions.set(session.id, session);
  track("session_created", { sessionId: session.id, listingId, surface });
  return buildView(session);
}

/**
 * Resume/poll. `surface` is recorded so we can measure cross-surface
 * continuity; passing `resume: true` marks an explicit resume (deep link or
 * page load) as opposed to a background poll.
 */
export function getSession(
  sessionId: string,
  opts: { surface?: Surface; resume?: boolean } = {},
): SessionView {
  const session = getSessionOrThrow(sessionId);
  expireIfNeeded(session);
  if (opts.resume && opts.surface) {
    const crossSurface = opts.surface !== session.lastResumedSurface;
    session.lastResumedSurface = opts.surface;
    // A cross-surface handoff is a visible state change: bump version so
    // other surfaces pick it up on their next poll.
    if (crossSurface) session.version++;
    track("session_resumed", {
      sessionId,
      surface: opts.surface,
      crossSurface,
      status: session.status,
    });
  }
  return buildView(session);
}

/**
 * Fan explicitly accepts the listing's current price after a change. Nothing
 * can be purchased at a price the fan has not seen: completion validates
 * acceptedPriceCents against the listing at commit time.
 */
export function acceptCurrentPrice(sessionId: string, surface: Surface): SessionView {
  const session = getSessionOrThrow(sessionId);
  expireIfNeeded(session);
  if (session.status === "expired") {
    throw new CheckoutError("SESSION_EXPIRED", "This checkout has expired", 410);
  }
  if (session.status !== "active") {
    throw new CheckoutError("INVALID", `Cannot accept price while ${session.status}`, 409);
  }
  const listing = getListingOrThrow(session.listingId);
  if (session.acceptedPriceCents !== listing.currentPriceCents) {
    const from = session.acceptedPriceCents;
    session.acceptedPriceCents = listing.currentPriceCents;
    session.version++;
    track("price_change_accepted", {
      sessionId,
      surface,
      fromCents: from,
      toCents: listing.currentPriceCents,
    });
  }
  return buildView(session);
}

export interface CompleteResult {
  view: SessionView;
  alreadyCompleted: boolean;
}

/**
 * Completion is idempotent and race-safe:
 * - a completed session returns the existing order (200), never a second one;
 * - the synchronous flip to payment_pending acts as a lock, so a second
 *   device that races the same session gets PAYMENT_IN_PROGRESS (409);
 * - the accepted price is revalidated at commit time, so a stale device gets
 *   PRICE_CHANGED (409) instead of silently paying a different amount.
 */
export async function completeSession(
  sessionId: string,
  params: { surface: Surface; simulateOutcome?: PaymentOutcome },
  provider: PaymentProvider = stubPaymentProvider,
): Promise<CompleteResult> {
  const session = getSessionOrThrow(sessionId);
  expireIfNeeded(session);

  if (session.status === "completed") {
    track("duplicate_complete_ignored", { sessionId, surface: params.surface });
    return { view: buildView(session), alreadyCompleted: true };
  }
  if (session.status === "payment_pending") {
    throw new CheckoutError(
      "PAYMENT_IN_PROGRESS",
      "Payment already in progress on another device",
      409,
    );
  }
  if (session.status === "expired") {
    throw new CheckoutError("SESSION_EXPIRED", "This checkout has expired", 410);
  }
  const listing = getListingOrThrow(session.listingId);
  if (session.acceptedPriceCents !== listing.currentPriceCents) {
    throw new CheckoutError("PRICE_CHANGED", "Price changed since you last saw it", 409, {
      acceptedPriceCents: session.acceptedPriceCents,
      currentPriceCents: listing.currentPriceCents,
    });
  }

  // Lock: flip before the first await so concurrent completes see it.
  session.status = "payment_pending";
  session.version++;
  session.lastPaymentError = undefined;
  track("payment_started", { sessionId, surface: params.surface });

  const totalCents = session.acceptedPriceCents * session.quantity;
  const result = await provider.authorize({
    sessionId,
    amountCents: totalCents,
    outcome: params.simulateOutcome,
  });

  if (!result.ok) {
    session.status = "active";
    session.lastPaymentError = result.declineReason ?? "Payment failed";
    session.version++;
    track("payment_declined", { sessionId, surface: params.surface });
    expireIfNeeded(session); // hold may have lapsed while the payment ran
    return { view: buildView(session), alreadyCompleted: false };
  }

  listing.heldQty = Math.max(0, listing.heldQty - session.quantity);
  listing.soldQty += session.quantity;
  session.order = {
    id: `ord_${crypto.randomUUID().slice(0, 8)}`,
    sessionId,
    listingId: listing.id,
    quantity: session.quantity,
    totalCents,
    completedAtISO: new Date().toISOString(),
    surface: params.surface,
  };
  session.status = "completed";
  session.version++;
  track("checkout_completed", {
    sessionId,
    surface: params.surface,
    crossSurface: params.surface !== session.createdSurface,
    totalCents,
  });
  return { view: buildView(session), alreadyCompleted: false };
}

/** Demo-only levers that stand in for the outside world changing. */
export const simulate = {
  changePrice(listingId: string, deltaCents: number): Listing {
    const listing = getListingOrThrow(listingId);
    listing.currentPriceCents = Math.max(100, listing.currentPriceCents + deltaCents);
    track("listing_price_changed", { listingId, toCents: listing.currentPriceCents });
    return listing;
  },
  expireNow(sessionId: string): SessionView {
    const session = getSessionOrThrow(sessionId);
    if (session.status === "active") {
      session.holdExpiresAt = Date.now() - 1;
      expireIfNeeded(session);
    }
    return buildView(session);
  },
};
