import { listListings } from "@/lib/checkout";
import { formatCents, formatEventDate } from "@/lib/format";
import StartCheckoutButton from "@/components/StartCheckoutButton";

// Availability changes as sessions hold/release inventory, so this page must
// always render live data.
export const dynamic = "force-dynamic";

export default function Home() {
  const listings = listListings();
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <p className="text-sm font-semibold tracking-widest text-accent">GAMETIME · PROTOTYPE</p>
        <h1 className="mt-1 text-3xl font-bold">Checkout Continuity</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">
          Start a checkout here (web), then resume it on the simulated mobile surface via
          deep link. The backend session survives the hop; duplicate orders, stale prices,
          and expired holds do not.
        </p>
      </header>

      <ul className="space-y-4">
        {listings.map((l) => {
          const available = l.totalQty - l.heldQty - l.soldQty;
          return (
            <li
              key={l.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5"
            >
              <div>
                <h2 className="text-lg font-semibold">{l.eventName}</h2>
                <p className="mt-0.5 text-sm text-white/60">
                  {l.venue} · {formatEventDate(l.eventDateISO)}
                </p>
                <p className="mt-1 text-sm text-white/60">
                  Sec {l.section} · Row {l.row} ·{" "}
                  <span className={available > 0 ? "text-accent" : "text-red-400"}>
                    {available > 0 ? `${available} left` : "Sold out"}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold">{formatCents(l.currentPriceCents)}</p>
                <p className="text-xs text-white/50">per ticket</p>
                <StartCheckoutButton listingId={l.id} disabled={available < 2} />
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-8 text-xs text-white/40">
        Quantity is fixed at 2 tickets to keep the demo focused on continuity. Starting
        checkout places a 5-minute inventory hold.
      </p>
    </main>
  );
}
