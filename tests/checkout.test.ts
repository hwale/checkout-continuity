import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CheckoutError,
  HOLD_TTL_MS,
  acceptCurrentPrice,
  completeSession,
  createSession,
  getSession,
  simulate,
} from "@/lib/checkout";
import { db, resetDb } from "@/lib/store";
import type { PaymentProvider } from "@/lib/payments";

const LISTING = "lst_warriors";

/** Instant providers so tests never wait on the stub's demo latency. */
const instantSuccess: PaymentProvider = {
  authorize: async () => ({ ok: true, authId: "auth_test" }),
};
const instantDecline: PaymentProvider = {
  authorize: async () => ({ ok: false, declineReason: "declined" }),
};
/** A provider we resolve by hand, to hold sessions in payment_pending. */
function deferredProvider() {
  let resolve!: (ok: boolean) => void;
  const gate = new Promise<boolean>((r) => (resolve = r));
  const provider: PaymentProvider = {
    authorize: async () => {
      const ok = await gate;
      return ok ? { ok: true, authId: "auth_deferred" } : { ok: false, declineReason: "declined" };
    },
  };
  return { provider, resolve };
}

function listing() {
  return db.listings.get(LISTING)!;
}

beforeEach(() => {
  resetDb();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("creating a session", () => {
  it("places an inventory hold and starts active", () => {
    const view = createSession({ listingId: LISTING, surface: "web" });
    expect(view.session.status).toBe("active");
    expect(view.session.acceptedPriceCents).toBe(listing().currentPriceCents);
    expect(listing().heldQty).toBe(2);
    expect(view.msRemaining).toBe(HOLD_TTL_MS);
  });

  it("rejects when not enough inventory is available", () => {
    createSession({ listingId: LISTING, surface: "web" }); // holds 2 of 4
    createSession({ listingId: LISTING, surface: "web" }); // holds 2 of 4
    expect(() => createSession({ listingId: LISTING, surface: "web" })).toThrowError(
      expect.objectContaining({ code: "SOLD_OUT" }),
    );
  });
});

describe("resuming across surfaces", () => {
  it("tracks the new surface and bumps version so other surfaces notice", () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    const before = session.version;
    const resumed = getSession(session.id, { surface: "mobile", resume: true });
    expect(resumed.session.lastResumedSurface).toBe("mobile");
    expect(resumed.session.version).toBe(before + 1);
    const event = db.events.find((e) => e.name === "session_resumed");
    expect(event?.props.crossSurface).toBe(true);
  });

  it("does not bump version on background polls", () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    const before = session.version;
    getSession(session.id, { surface: "web" });
    expect(getSession(session.id).session.version).toBe(before);
  });
});

describe("hold expiration", () => {
  it("expires lazily on read after the TTL and releases the hold", () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    vi.advanceTimersByTime(HOLD_TTL_MS + 1);
    const view = getSession(session.id);
    expect(view.session.status).toBe("expired");
    expect(listing().heldQty).toBe(0);
  });

  it("cannot expire a session that is mid-payment", async () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    const { provider, resolve } = deferredProvider();
    const completion = completeSession(session.id, { surface: "web" }, provider);
    vi.advanceTimersByTime(HOLD_TTL_MS + 1);
    expect(getSession(session.id).session.status).toBe("payment_pending");
    resolve(true);
    const result = await completion;
    expect(result.view.session.status).toBe("completed");
  });

  it("applies expiry immediately after a decline if the hold lapsed mid-payment", async () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    const { provider, resolve } = deferredProvider();
    const completion = completeSession(session.id, { surface: "web" }, provider);
    vi.advanceTimersByTime(HOLD_TTL_MS + 1);
    resolve(false);
    const result = await completion;
    expect(result.view.session.status).toBe("expired");
  });

  it("rejects completion of an expired session with 410", async () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    vi.advanceTimersByTime(HOLD_TTL_MS + 1);
    await expect(completeSession(session.id, { surface: "web" }, instantSuccess)).rejects.toThrowError(
      expect.objectContaining({ code: "SESSION_EXPIRED", httpStatus: 410 }),
    );
  });
});

describe("price changes", () => {
  it("surfaces a price change as a derived flag, not a status", () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    simulate.changePrice(LISTING, 2500);
    const view = getSession(session.id);
    expect(view.session.status).toBe("active");
    expect(view.priceChanged).toBe(true);
  });

  it("blocks completion at a price the fan has not accepted", async () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    simulate.changePrice(LISTING, 2500);
    await expect(completeSession(session.id, { surface: "web" }, instantSuccess)).rejects.toThrowError(
      expect.objectContaining({ code: "PRICE_CHANGED", httpStatus: 409 }),
    );
  });

  it("completes at the new price after explicit acceptance", async () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    const original = session.acceptedPriceCents;
    simulate.changePrice(LISTING, 2500);
    const accepted = acceptCurrentPrice(session.id, "mobile");
    expect(accepted.session.acceptedPriceCents).toBe(original + 2500);
    const result = await completeSession(session.id, { surface: "mobile" }, instantSuccess);
    expect(result.view.session.status).toBe("completed");
    expect(result.view.session.order?.totalCents).toBe((original + 2500) * 2);
  });
});

describe("payment failure", () => {
  it("returns the session to active with the error, keeping the hold", async () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    const result = await completeSession(session.id, { surface: "web" }, instantDecline);
    expect(result.view.session.status).toBe("active");
    expect(result.view.session.lastPaymentError).toContain("declined");
    expect(listing().heldQty).toBe(2);
    // Retry succeeds.
    const retry = await completeSession(session.id, { surface: "web" }, instantSuccess);
    expect(retry.view.session.status).toBe("completed");
  });
});

describe("duplicate completion", () => {
  it("is idempotent: a second complete returns the same order, no double sale", async () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    const first = await completeSession(session.id, { surface: "web" }, instantSuccess);
    const second = await completeSession(session.id, { surface: "mobile" }, instantSuccess);
    expect(second.alreadyCompleted).toBe(true);
    expect(second.view.session.order?.id).toBe(first.view.session.order?.id);
    expect(listing().soldQty).toBe(2); // one session's worth, not two
  });

  it("serializes two devices racing the same session: exactly one order", async () => {
    const { session } = createSession({ listingId: LISTING, surface: "web" });
    const { provider, resolve } = deferredProvider();

    const fromWeb = completeSession(session.id, { surface: "web" }, provider);
    // Mobile taps Pay while web's payment is still in flight.
    const fromMobile = completeSession(session.id, { surface: "mobile" }, instantSuccess).then(
      () => "completed" as const,
      (err: CheckoutError) => err.code,
    );
    resolve(true);

    const [webResult, mobileOutcome] = await Promise.all([fromWeb, fromMobile]);
    expect(webResult.view.session.status).toBe("completed");
    expect(mobileOutcome).toBe("PAYMENT_IN_PROGRESS");
    expect(listing().soldQty).toBe(2);
    expect(db.events.filter((e) => e.name === "checkout_completed")).toHaveLength(1);
  });
});
