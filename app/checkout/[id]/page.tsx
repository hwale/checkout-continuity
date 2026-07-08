import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/checkout";
import CheckoutClient from "@/components/CheckoutClient";
import type { SessionView } from "@/lib/types";

// Checkout truth must never come from a static cache.
export const dynamic = "force-dynamic";

/**
 * Desktop web checkout. This is a server component: the full checkout context
 * (event, seats, price, status, expiry) is fetched server-side and rendered
 * into the initial HTML, so the page is meaningful before any JavaScript
 * loads. Hydration only adds polling and button handlers.
 */
export default async function CheckoutPage({
  params,
}: PageProps<"/checkout/[id]">) {
  const { id } = await params;
  let view: SessionView;
  try {
    // Server-side page load counts as a resume on the web surface.
    view = getSession(id, { surface: "web", resume: true });
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest text-accent">
            GAMETIME · WEB CHECKOUT
          </p>
          <h1 className="mt-1 text-2xl font-bold">Checkout</h1>
        </div>
        <Link href="/" className="text-sm text-white/50 hover:text-white/80">
          ← All events
        </Link>
      </header>
      <CheckoutClient initial={view} surface="web" />
    </main>
  );
}
