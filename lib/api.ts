import { NextResponse } from "next/server";
import { CheckoutError } from "./checkout";
import type { Surface } from "./types";

/** All session responses are uncacheable: checkout truth is always live. */
export function json<T>(body: T, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function toErrorResponse(err: unknown) {
  if (err instanceof CheckoutError) {
    return json(
      { error: { code: err.code, message: err.message, details: err.details ?? null } },
      err.httpStatus,
    );
  }
  console.error("Unhandled API error:", err);
  return json({ error: { code: "INTERNAL", message: "Unexpected error" } }, 500);
}

export function parseSurface(value: unknown): Surface {
  return value === "mobile" ? "mobile" : "web";
}
