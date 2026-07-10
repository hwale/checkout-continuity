import type { AnalyticsEvent, CheckoutSession, Listing } from "./types";

/**
 * In-memory store, per the assignment constraints. Kept on globalThis so it
 * survives Next.js dev-server HMR reloads; in production this would be
 * Redis/Postgres keyed by session id with a TTL index.
 */
interface Db {
  listings: Map<string, Listing>;
  sessions: Map<string, CheckoutSession>;
  events: AnalyticsEvent[];
}

function seedListings(): Map<string, Listing> {
  const listings: Listing[] = [
    {
      id: "lst_warriors",
      eventName: "Warriors vs Lakers",
      venue: "Chase Center",
      eventDateISO: "2026-08-14T19:30:00-07:00",
      section: "112",
      row: "8",
      currentPriceCents: 14200,
      totalQty: 4,
      heldQty: 0,
      soldQty: 0,
    },
    {
      id: "lst_giants",
      eventName: "Giants vs Dodgers",
      venue: "Oracle Park",
      eventDateISO: "2026-08-07T18:45:00-07:00",
      section: "VB 331",
      row: "3",
      currentPriceCents: 5800,
      totalQty: 2,
      heldQty: 0,
      soldQty: 0,
    },
    {
      id: "lst_concert",
      eventName: "Khruangbin",
      venue: "Greek Theatre",
      eventDateISO: "2026-08-21T20:00:00-07:00",
      section: "GA",
      row: "-",
      currentPriceCents: 9900,
      totalQty: 6,
      heldQty: 0,
      soldQty: 0,
    },
  ];
  return new Map(listings.map((l) => [l.id, l]));
}

function createDb(): Db {
  return { listings: seedListings(), sessions: new Map(), events: [] };
}

const g = globalThis as unknown as { __gtCheckoutDb?: Db };
export const db: Db = (g.__gtCheckoutDb ??= createDb());

export function resetDb(): void {
  const fresh = createDb();
  db.listings = fresh.listings;
  db.sessions = fresh.sessions;
  db.events = fresh.events;
}
