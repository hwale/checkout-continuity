"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StartCheckoutButton({
  listingId,
  disabled,
}: {
  listingId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, surface: "web" }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error.message);
        setBusy(false);
        return;
      }
      router.push(`/checkout/${json.session.id}`);
    } catch {
      setError("Network error, try again");
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={start}
        disabled={disabled || busy}
        className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Holding seats…" : "Buy now"}
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
