import { createSession } from "@/lib/checkout";
import { json, parseSurface, toErrorResponse } from "@/lib/api";

/** POST /api/sessions — start a checkout session (places an inventory hold). */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const view = createSession({
      listingId: String(body.listingId ?? ""),
      quantity: body.quantity === undefined ? undefined : Number(body.quantity),
      surface: parseSurface(body.surface),
    });
    return json(view, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
