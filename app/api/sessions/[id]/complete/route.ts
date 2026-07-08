import { completeSession } from "@/lib/checkout";
import { json, parseSurface, toErrorResponse } from "@/lib/api";
import type { PaymentOutcome } from "@/lib/types";

const OUTCOMES: PaymentOutcome[] = ["success", "decline", "slow_success"];

/**
 * POST /api/sessions/:id/complete — attempt payment and finalize the order.
 * Idempotent: an already-completed session returns its existing order with
 * alreadyCompleted=true. A concurrent attempt gets 409 PAYMENT_IN_PROGRESS;
 * a stale price gets 409 PRICE_CHANGED; an expired hold gets 410.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/complete">) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const outcome = OUTCOMES.includes(body.simulateOutcome)
      ? (body.simulateOutcome as PaymentOutcome)
      : undefined;
    const result = await completeSession(id, {
      surface: parseSurface(body.surface),
      simulateOutcome: outcome,
    });
    return json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
