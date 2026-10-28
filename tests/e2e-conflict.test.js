// Tool 02 HTTP end-to-end tests against a RUNNING server.
// Run: E2E_BASE_URL=http://127.0.0.1:3102 node --test tests/e2e-conflict.test.js
// Skipped when E2E_BASE_URL is unset. HTTP-level only (no Playwright binary
// in this VM). Synthetic users only. No paired connector exists for these
// users, so POSTs exercise the blocked-snapshot path (422, no row) rather
// than a full diagnostic; the full path is covered by DB tests + the real
// wp-dev integration run documented in docs/plugin-theme-checker.md.
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL;
const stamp = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jar() {
  let cookie = "";
  return {
    header() { return cookie ? { Cookie: cookie } : {}; },
    store(res) {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      const parts = raw.map((c) => c.split(";")[0]).filter(Boolean);
      if (parts.length) cookie = parts.join("; ");
    },
  };
}

async function req(path, { method = "GET", body, cookies } = {}) {
  if (path.includes("/api/auth/sign-")) await sleep(10500);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: BASE, ...cookies?.header() },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (cookies) cookies.store(res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML */ }
  return { res, json, text };
}

let cookies;
let websiteId;

test("conflict e2e: register + create website", { skip: !BASE }, async () => {
  cookies = jar();
  const email = `conflict-e2e-${stamp}@example.com`;
  let r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Conflict E2E", email, password: "Password123" },
    cookies,
  });
  assert.ok([200, 201].includes(r.res.status), `sign-up ${r.res.status}: ${r.text.slice(0, 300)}`);
  r = await req("/api/websites", { method: "POST", body: { name: "Shop", url: "https://conflict-shop.example.com/" }, cookies });
  assert.equal(r.res.status, 201, r.text.slice(0, 300));
  websiteId = r.json.website.id;
});

test("conflict e2e: unauthenticated API access rejected", { skip: !BASE }, async () => {
  let r = await req("/api/conflict-diagnostics", { method: "POST", body: { websiteId, symptomCategory: "OTHER", symptomDescription: "x" } });
  assert.equal(r.res.status, 401);
  r = await req("/api/conflict-diagnostics");
  assert.equal(r.res.status, 401);
  r = await req("/api/conflict-diagnostics/nonexistent-id");
  assert.equal(r.res.status, 401);
  r = await req("/api/conflict-diagnostics/snapshot?websiteId=nonexistent");
  assert.equal(r.res.status, 401);
});

test("conflict e2e: unconnected website blocks with SNAPSHOT_MISSING and no row", { skip: !BASE }, async () => {
  let r = await req("/api/conflict-diagnostics", {
    method: "POST",
    body: { websiteId, symptomCategory: "ADMIN_ERROR", symptomDescription: "Admin blank." },
    cookies,
  });
  assert.equal(r.res.status, 422, r.text.slice(0, 300));
  assert.equal(r.json.snapshotStatus, "SNAPSHOT_MISSING");
  assert.match(r.json.resyncInstructions, /diagnostic sync/);
  // Blocked runs persist nothing: history stays empty.
  r = await req("/api/conflict-diagnostics", { cookies });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.total, 0);
  assert.deepEqual(r.json.diagnostics, []);
});

test("conflict e2e: arbitrary client snapshot rejected (ignored), invalid input rejected", { skip: !BASE }, async () => {
  // A client-supplied snapshot must not create a diagnostic: the website
  // still has no snapshot, so the result is still the blocked 422.
  let r = await req("/api/conflict-diagnostics", {
    method: "POST",
    body: {
      websiteId, symptomCategory: "OTHER", symptomDescription: "Forged.",
      snapshot: { schemaVersion: 2, plugins: [] }, connectorId: "forged", ownerId: "forged",
    },
    cookies,
  });
  assert.equal(r.res.status, 422);
  assert.equal(r.json.snapshotStatus, "SNAPSHOT_MISSING");

  r = await req("/api/conflict-diagnostics", {
    method: "POST",
    body: { websiteId, symptomCategory: "NOPE", symptomDescription: "x" },
    cookies,
  });
  assert.equal(r.res.status, 400);
  r = await req("/api/conflict-diagnostics", {
    method: "POST",
    body: { websiteId, symptomCategory: "OTHER", symptomDescription: "x".repeat(2001) },
    cookies,
  });
  assert.equal(r.res.status, 400);
  r = await req("/api/conflict-diagnostics", {
    method: "POST",
    body: { websiteId, symptomCategory: "OTHER", symptomDescription: "x".repeat(2001) },
    cookies,
  });
  // Oversized description is a validation 400 (body itself stays under 10 KiB).
  assert.equal(r.res.status, 400);
});

test("conflict e2e: snapshot endpoint + ownership 404s", { skip: !BASE }, async () => {
  let r = await req(`/api/conflict-diagnostics/snapshot?websiteId=${websiteId}`, { cookies });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.snapshotStatus, "SNAPSHOT_MISSING");
  assert.equal(r.json.snapshot, null);
  r = await req("/api/conflict-diagnostics/snapshot?websiteId=nonexistent-id", { cookies });
  assert.equal(r.res.status, 404);
  r = await req("/api/conflict-diagnostics/nonexistent-id", { cookies });
  assert.equal(r.res.status, 404);
  r = await req("/api/conflict-diagnostics/nonexistent-id/ai-analysis", { method: "POST", body: {}, cookies });
  assert.equal(r.res.status, 404);
});

test("conflict e2e: UI pages render (HTTP level) + empty history", { skip: !BASE }, async () => {
  let r = await req("/tools/plugin-theme-checker", { cookies });
  assert.equal(r.res.status, 200);
  assert.match(r.text, /Plugin &amp; Theme Conflict Checker|Plugin & Theme Conflict Checker/);
  r = await req("/tools/plugin-theme-checker/history", { cookies });
  assert.equal(r.res.status, 200);
  assert.match(r.text, /No conflict checks yet/);
  r = await req("/tools/plugin-theme-checker/nonexistent-id", { cookies });
  assert.equal(r.res.status, 404);
  // Unauthenticated tool page redirects to login.
  r = await req("/tools/plugin-theme-checker");
  assert.ok([303, 307].includes(r.res.status), `redirect status ${r.res.status}`);
});

test("conflict e2e: repeated requests hit the per-user rate limit", { skip: !BASE }, async () => {
  let saw429 = false;
  for (let i = 0; i < 25; i++) {
    const r = await req("/api/conflict-diagnostics", {
      method: "POST",
      body: { websiteId, symptomCategory: "OTHER", symptomDescription: "rate test" },
      cookies,
    });
    if (r.res.status === 429) { saw429 = true; break; }
    assert.equal(r.res.status, 422, `attempt ${i}: ${r.res.status} ${r.text.slice(0, 200)}`);
  }
  assert.equal(saw429, true, "expected a 429 within 25 attempts (limit 20/hour/user)");
});
