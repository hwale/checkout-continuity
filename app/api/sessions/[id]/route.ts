import { getSession } from "@/lib/checkout";
import { json, parseSurface, toErrorResponse } from "@/lib/api";

/**
 * GET /api/sessions/:id — resume or poll a session.
 * ?surface=web|mobile identifies the caller; &resume=1 marks an explicit
 * resume (deep link, page load, app foreground) rather than a background poll.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const view = getSession(id, {
      surface: parseSurface(url.searchParams.get("surface")),
      resume: url.searchParams.get("resume") === "1",
    });
    return json(view);
  } catch (err) {
    return toErrorResponse(err);
  }
}
