"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PaymentOutcome, SessionView, Surface } from "@/lib/types";
import { formatCents, formatMs } from "@/lib/format";

const POLL_MS = 3000;

/**
 * The interactive island. The server renders this component's initial markup
 * (event, seats, price, status, countdown) into the page HTML, so the fan
 * sees full checkout context before hydration; after hydration it polls the
 * session endpoint and re-renders whenever the server-side version changes.
 */
export default function CheckoutClient({
  initial,
  surface,
}: {
  initial: SessionView;
  surface: Surface;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<"pay" | "accept" | "restart" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PaymentOutcome>("success");
  // Countdown uses the server clock: offset corrects for client clock skew.
  const clockOffset = useRef(initial.serverNow - Date.now());
  const [now, setNow] = useState(initial.serverNow);

  const sessionId = initial.session.id;
  const { session, listing } = view;

  const refresh = useCallback(
    async (resume = false) => {
      try {
        const res = await fetch(
          `/api/sessions/${sessionId}?surface=${surface}${resume ? "&resume=1" : ""}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (!json.error) {
          setView(json);
          clockOffset.current = json.serverNow - Date.now();
        }
      } catch {
        // Transient network failure: the next poll retries.
      }
    },
    [sessionId, surface],
  );

  useEffect(() => {
    const poll = setInterval(() => refresh(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
    // Coming back to the tab is a resume, the web analog of an app foreground.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const msLeft =
    session.status === "active" ? Math.max(0, session.holdExpiresAt - now) : 0;

  // If the local countdown hits zero, ask the server: it is the only judge.
  const locallyLapsed = session.status === "active" && msLeft === 0;
  useEffect(() => {
    if (locallyLapsed) refresh();
  }, [locallyLapsed, refresh]);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function pay() {
    setBusy("pay");
    setNotice(null);
    const json = await post(`/api/sessions/${sessionId}/complete`, {
      surface,
      simulateOutcome: outcome,
    });
    if (json.error) {
      // Conflicts mean the world moved: re-fetch truth, then explain.
      if (json.error.code !== "PAYMENT_IN_PROGRESS") await refresh();
      setNotice(json.error.message);
    } else {
      setView(json.view);
      if (json.alreadyCompleted) {
        setNotice("This order was already completed on another surface. You were not charged twice.");
      }
    }
    setBusy(null);
  }

  async function acceptPrice() {
    setBusy("accept");
    setNotice(null);
    const json = await post(`/api/sessions/${sessionId}/accept-price`, { surface });
    if (json.error) {
      await refresh();
      setNotice(json.error.message);
    } else {
      setView(json);
    }
    setBusy(null);
  }

  async function restart() {
    setBusy("restart");
    setNotice(null);
    const json = await post("/api/sessions", { listingId: listing.id, surface });
    if (json.error) {
      setNotice(json.error.message);
      setBusy(null);
      return;
    }
    router.push(
      surface === "mobile" ? `/m/checkout/${json.session.id}` : `/checkout/${json.session.id}`,
    );
  }

  async function simulate(body: Record<string, unknown>) {
    await post("/api/dev/simulate", body);
    await refresh();
  }

  const otherSurfaceHref =
    surface === "mobile" ? `/checkout/${sessionId}` : `/m/checkout/${sessionId}`;

  return (
    <div className="space-y-4">
      {/* Status strip: always visible, updates via polling */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusPill status={session.status} />
        {session.status === "active" && (
          <span
            suppressHydrationWarning
            className={`rounded-full px-2.5 py-1 font-mono font-semibold ${
              msLeft < 60_000 ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/80"
            }`}
          >
            hold {formatMs(msLeft)}
          </span>
        )}
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/60">
          started on {session.createdSurface}
        </span>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/60">
          last active: {session.lastResumedSurface}
        </span>
      </div>

      {/* Order summary */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-lg font-semibold">{listing.eventName}</h2>
        <p className="mt-0.5 text-sm text-white/60">{listing.venue}</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-white/60">Seats</dt>
            <dd>
              Sec {listing.section} · Row {listing.row} · {session.quantity} tickets
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/60">Price per ticket</dt>
            <dd>{formatCents(session.acceptedPriceCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatCents(session.acceptedPriceCents * session.quantity)}</dd>
          </div>
        </dl>
      </section>

      {/* State-dependent panels */}
      {view.priceChanged && session.status === "active" && (
        <section className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm">
          <p className="font-semibold text-amber-300">Price changed while you were away</p>
          <p className="mt-1 text-white/70">
            {formatCents(session.acceptedPriceCents)} → {formatCents(listing.currentPriceCents)}{" "}
            per ticket. Review and accept to continue; you will never be charged a price you
            have not seen.
          </p>
          <button
            onClick={acceptPrice}
            disabled={busy !== null}
            className="mt-3 rounded-full bg-amber-400 px-4 py-1.5 font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {busy === "accept" ? "Updating…" : `Accept ${formatCents(listing.currentPriceCents)}/ticket`}
          </button>
        </section>
      )}

      {session.lastPaymentError && session.status === "active" && (
        <section className="rounded-2xl border border-red-400/40 bg-red-400/10 p-4 text-sm">
          <p className="font-semibold text-red-300">Payment failed</p>
          <p className="mt-1 text-white/70">{session.lastPaymentError}. Your seats are still held.</p>
        </section>
      )}

      {session.status === "payment_pending" && (
        <section className="rounded-2xl border border-sky-400/40 bg-sky-400/10 p-4 text-sm">
          <p className="font-semibold text-sky-300">
            <Spinner /> Payment processing…
          </p>
          <p className="mt-1 text-white/70">
            A payment for this session is in flight (it may have started on another device).
            This surface will update automatically.
          </p>
        </section>
      )}

      {session.status === "completed" && session.order && (
        <section className="rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm">
          <p className="text-base font-bold text-accent">You&apos;re in! 🎟️</p>
          <dl className="mt-2 space-y-1 text-white/80">
            <div className="flex justify-between">
              <dt>Order</dt>
              <dd className="font-mono">{session.order.id}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Total charged</dt>
              <dd>{formatCents(session.order.totalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Completed on</dt>
              <dd>{session.order.surface}</dd>
            </div>
          </dl>
        </section>
      )}

      {session.status === "expired" && (
        <section className="rounded-2xl border border-red-400/40 bg-red-400/10 p-4 text-sm">
          <p className="font-semibold text-red-300">This checkout expired</p>
          <p className="mt-1 text-white/70">
            The seat hold lapsed and the tickets were released to other fans. If they are
            still available you can start over at the current price.
          </p>
          <button
            onClick={restart}
            disabled={busy !== null}
            className="mt-3 rounded-full bg-white px-4 py-1.5 font-semibold text-black transition hover:brightness-90 disabled:opacity-40"
          >
            {busy === "restart" ? "Checking availability…" : "Restart checkout"}
          </button>
        </section>
      )}

      {notice && (
        <p className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white/80">{notice}</p>
      )}

      {/* Primary action */}
      {session.status === "active" && (
        <button
          onClick={pay}
          disabled={busy !== null || view.priceChanged}
          className="w-full rounded-2xl bg-accent py-3 text-base font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "pay"
            ? "Processing…"
            : view.priceChanged
              ? "Accept the new price to continue"
              : `Pay ${formatCents(session.acceptedPriceCents * session.quantity)}`}
        </button>
      )}

      {/* Continuity + demo controls */}
      <section className="rounded-2xl border border-dashed border-white/15 p-4 text-xs text-white/60">
        <p className="font-semibold uppercase tracking-wider text-white/40">
          Continuity & demo controls
        </p>
        <p className="mt-2">
          {/* New window on purpose: the demo is two surfaces side by side. */}
          <Link
            href={otherSurfaceHref}
            target="_blank"
            rel="noopener"
            className="text-accent underline underline-offset-2"
          >
            {surface === "mobile"
              ? "Open this session on desktop web →"
              : "Resume this session on mobile (deep link) →"}
          </Link>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            payment:
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as PaymentOutcome)}
              className="rounded bg-white/10 px-1.5 py-0.5 text-white/80"
            >
              <option value="success">success (1.2s)</option>
              <option value="slow_success">slow success (4s)</option>
              <option value="decline">decline</option>
            </select>
          </label>
          <button
            onClick={() => simulate({ action: "price_change", listingId: listing.id, deltaCents: 2500 })}
            className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
          >
            price +$25
          </button>
          <button
            onClick={() => simulate({ action: "price_change", listingId: listing.id, deltaCents: -1000 })}
            className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
          >
            price −$10
          </button>
          <button
            onClick={() => simulate({ action: "expire_session", sessionId })}
            className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
          >
            force expire
          </button>
        </div>
        <p className="mt-2 text-white/40">
          These mutate real backend state through the same code paths external events would.
          Session <span className="font-mono">{sessionId}</span> · v{session.version} · polls
          every {POLL_MS / 1000}s
        </p>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-accent/20 text-accent",
    payment_pending: "bg-sky-400/20 text-sky-300",
    completed: "bg-accent/20 text-accent",
    expired: "bg-red-500/20 text-red-300",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 font-semibold ${styles[status] ?? "bg-white/10"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function Spinner() {
  return (
    <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-300 border-t-transparent align-middle" />
  );
}
