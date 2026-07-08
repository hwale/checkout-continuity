import { acceptCurrentPrice } from "@/lib/checkout";
import { json, parseSurface, toErrorResponse } from "@/lib/api";

/**
 * POST /api/sessions/:id/accept-price — fan explicitly accepts the listing's
 * current price after a change. Completion always revalidates against the
 * listing, so skipping this step can never buy at an unseen price.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/accept-price">) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    return json(acceptCurrentPrice(id, parseSurface(body.surface)));
  } catch (err) {
    return toErrorResponse(err);
  }
}
