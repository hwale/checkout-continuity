import type { PaymentOutcome, PaymentResult } from "./types";

/**
 * Stub payment provider behind a clear interface. A real implementation would
 * create a PaymentIntent with an idempotency key derived from the session id,
 * so provider-side retries can never double-charge.
 */
export interface PaymentProvider {
  authorize(params: {
    sessionId: string;
    amountCents: number;
    outcome?: PaymentOutcome;
  }): Promise<PaymentResult>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const stubPaymentProvider: PaymentProvider = {
  async authorize({ sessionId, outcome = "success" }) {
    // Latency is intentional: it opens a window where a second device can
    // observe (and race) the payment_pending state.
    await delay(outcome === "slow_success" ? 4000 : 1200);
    if (outcome === "decline") {
      return { ok: false, declineReason: "Card declined by issuer (simulated)" };
    }
    return { ok: true, authId: `auth_${sessionId.slice(-6)}` };
  },
};
