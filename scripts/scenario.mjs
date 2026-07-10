/**
 * End-to-end scripted scenario against the running dev server (npm run dev),
 * exercising every important state transition over the real HTTP API:
 *
 *   node scripts/scenario.mjs [baseUrl]
 *
 * 1. Web creates a session (inventory hold placed)
 * 2. Mobile resumes it via the deep-link route's API call
 * 3. Price changes while the fan is away -> completion is blocked (409)
 * 4. Fan accepts the new price on mobile -> completion succeeds on mobile
 * 5. Web retries completion -> idempotent 200, same order, no double charge
 * 6. A second session expires -> completion returns 410, restart required
 * 7. Two devices race completion of a third session -> exactly one order
 */
const BASE = process.argv[2] ?? "http://localhost:3000";
let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

/** A step the rest of the script depends on: stop with a clear message rather than a TypeError. */
function mustSucceed(label, result) {
  if (result.json.error) {
    console.error(`ABORT ${label}: ${result.json.error.code} — ${result.json.error.message}`);
    process.exit(1);
  }
  return result;
}

// --- 0. connectivity check, then reset demo state so runs are repeatable ---
try {
  await fetch(BASE);
} catch {
  console.error(
    `Cannot reach ${BASE}. Is the dev server running?\n` +
      `Note: if port 3000 was busy, "npm run dev" starts on another port — pass it explicitly:\n` +
      `  node scripts/scenario.mjs http://localhost:3001`,
  );
  process.exit(1);
}
await api("POST", "/api/dev/simulate", { action: "reset" });

// --- 1. create on web ---
const created = mustSucceed(
  "create session",
  await api("POST", "/api/sessions", { listingId: "lst_concert", surface: "web" }),
);
check("create session on web -> 201 active", created.status === 201 && created.json.session.status === "active");
const id = created.json.session.id;

// --- 2. resume on mobile ---
const resumed = await api("GET", `/api/sessions/${id}?surface=mobile&resume=1`);
check(
  "resume on mobile -> surface recorded, version bumped",
  resumed.json.session.lastResumedSurface === "mobile" &&
    resumed.json.session.version === created.json.session.version + 1,
);

// --- 3. price changes while away ---
await api("POST", "/api/dev/simulate", { action: "price_change", listingId: "lst_concert", deltaCents: 2500 });
const stale = await api("GET", `/api/sessions/${id}?surface=mobile`);
check("price change is visible on next poll", stale.json.priceChanged === true);

const blocked = await api("POST", `/api/sessions/${id}/complete`, { surface: "mobile" });
check("completion blocked at unseen price -> 409 PRICE_CHANGED", blocked.status === 409 && blocked.json.error.code === "PRICE_CHANGED");

// --- 4. accept and complete on mobile ---
const accepted = await api("POST", `/api/sessions/${id}/accept-price`, { surface: "mobile" });
check("explicit price acceptance clears the flag", accepted.json.priceChanged === false);

const completed = await api("POST", `/api/sessions/${id}/complete`, { surface: "mobile" });
check(
  "completion succeeds on mobile after acceptance",
  completed.status === 200 && completed.json.view.session.status === "completed" && !completed.json.alreadyCompleted,
);

// --- 5. duplicate completion from web ---
const dup = await api("POST", `/api/sessions/${id}/complete`, { surface: "web" });
check(
  "duplicate completion from web -> idempotent, same order",
  dup.status === 200 && dup.json.alreadyCompleted === true &&
    dup.json.view.session.order.id === completed.json.view.session.order.id,
);

// --- 6. expiry path ---
const second = mustSucceed(
  "create second session",
  await api("POST", "/api/sessions", { listingId: "lst_concert", surface: "web" }),
);
const sid = second.json.session.id;
await api("POST", "/api/dev/simulate", { action: "expire_session", sessionId: sid });
const expired = await api("GET", `/api/sessions/${sid}?surface=web`);
check("expired session reads as expired", expired.json.session.status === "expired");
const tooLate = await api("POST", `/api/sessions/${sid}/complete`, { surface: "web" });
check("completing an expired session -> 410", tooLate.status === 410 && tooLate.json.error.code === "SESSION_EXPIRED");

// --- 7. two devices race the same session ---
const third = mustSucceed(
  "create third session",
  await api("POST", "/api/sessions", { listingId: "lst_warriors", surface: "web" }),
);
const rid = third.json.session.id;
const [a, b] = await Promise.all([
  api("POST", `/api/sessions/${rid}/complete`, { surface: "web", simulateOutcome: "slow_success" }),
  api("POST", `/api/sessions/${rid}/complete`, { surface: "mobile", simulateOutcome: "slow_success" }),
]);
const outcomes = [a, b].map((r) => (r.status === 200 ? "completed" : r.json.error.code)).sort();
check(
  "two-device race -> exactly one order, loser told payment in progress",
  outcomes[0] === "PAYMENT_IN_PROGRESS" && outcomes[1] === "completed",
  outcomes.join(" / "),
);

console.log(failures === 0 ? "\nAll scenario steps passed." : `\n${failures} step(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
