import { simulate } from "@/lib/checkout";
import { json, toErrorResponse } from "@/lib/api";

/**
 * POST /api/dev/simulate — demo-only levers that stand in for the outside
 * world changing (marketplace repricing, holds lapsing). They mutate real
 * server state through the same code paths production events would, so the
 * transitions the UI shows are the actual state machine at work.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "price_change": {
        const listing = simulate.changePrice(
          String(body.listingId ?? ""),
          Number(body.deltaCents ?? 0),
        );
        return json({ ok: true, currentPriceCents: listing.currentPriceCents });
      }
      case "expire_session":
        return json({ ok: true, view: simulate.expireNow(String(body.sessionId ?? "")) });
      default:
        return json({ error: { code: "INVALID", message: "Unknown action" } }, 400);
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
