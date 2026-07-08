import { notFound } from "next/navigation";
import { getSession } from "@/lib/checkout";
import CheckoutClient from "@/components/CheckoutClient";
import type { SessionView } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Simulated mobile app surface, reached by "deep link". In production this
 * route is what gametime://checkout/{sessionId} (universal link) resolves to:
 * the app carries only the session id and asks the backend for truth, so a
 * link shared minutes ago still lands on the current state, not a snapshot.
 */
export default async function MobileCheckoutPage({
  params,
}: PageProps<"/m/checkout/[id]">) {
  const { id } = await params;
  let view: SessionView;
  try {
    // Opening the deep link counts as a resume on the mobile surface.
    view = getSession(id, { surface: "mobile", resume: true });
  } catch {
    notFound();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black/40 px-4 py-8">
      {/* Phone frame */}
      <div className="w-full max-w-sm overflow-hidden rounded-[2.5rem] border-4 border-white/15 bg-background shadow-2xl">
        {/* Status bar */}
        <div className="flex items-center justify-between bg-white/[0.06] px-6 py-2 text-[10px] text-white/50">
          <span>9:41</span>
          <span className="h-4 w-16 rounded-full bg-black/60" aria-hidden />
          <span>5G ▮▮▮</span>
        </div>
        {/* Deep-link provenance banner */}
        <div className="border-b border-white/10 bg-accent/10 px-4 py-2 text-[11px] text-accent">
          Opened via deep link:{" "}
          <span className="font-mono">gametime://checkout/{id}</span>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <p className="mb-3 text-xs font-semibold tracking-widest text-accent">
            GAMETIME · MOBILE APP (SIMULATED)
          </p>
          <CheckoutClient initial={view} surface="mobile" />
        </div>
      </div>
    </main>
  );
}
