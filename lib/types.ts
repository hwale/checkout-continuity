export type Surface = "web" | "mobile";

export type SessionStatus =
  | "active" // hold in place, fan can complete
  | "payment_pending" // a device is mid-payment; other devices must wait
  | "completed" // order placed
  | "expired"; // hold released; fan must restart

export interface Listing {
  id: string;
  eventName: string;
  venue: string;
  eventDateISO: string;
  section: string;
  row: string;
  currentPriceCents: number; // per ticket, source of truth for price
  totalQty: number;
  heldQty: number;
  soldQty: number;
}

export interface Order {
  id: string;
  sessionId: string;
  listingId: string;
  quantity: number;
  totalCents: number;
  completedAtISO: string;
  surface: Surface;
}

export interface CheckoutSession {
  id: string;
  listingId: string;
  quantity: number;
  /** Per-ticket price the fan has last seen and accepted. */
  acceptedPriceCents: number;
  status: SessionStatus;
  holdExpiresAt: number; // epoch ms; meaningful while status === "active"
  version: number; // bumps on every mutation; clients poll and diff on this
  createdAt: number;
  createdSurface: Surface;
  lastResumedSurface: Surface;
  order?: Order;
  lastPaymentError?: string;
}

/** What clients receive. Includes derived fields the server computes per read. */
export interface SessionView {
  session: CheckoutSession;
  listing: Pick<
    Listing,
    "id" | "eventName" | "venue" | "eventDateISO" | "section" | "row" | "currentPriceCents"
  >;
  /** True when the listing price no longer matches what the fan accepted. */
  priceChanged: boolean;
  /** Milliseconds until the hold expires (0 when not active). */
  msRemaining: number;
  serverNow: number;
}

export interface AnalyticsEvent {
  at: number;
  name: string;
  props: Record<string, string | number | boolean>;
}

export type PaymentOutcome = "success" | "decline" | "slow_success";

export interface PaymentResult {
  ok: boolean;
  authId?: string;
  declineReason?: string;
}
