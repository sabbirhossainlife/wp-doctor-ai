// Tool 03 HTTP end-to-end tests against a RUNNING server.
// Run: E2E_BASE_URL=http://127.0.0.1:3102 node --test tests/e2e-woocommerce.test.js
// Skipped when E2E_BASE_URL is unset. HTTP-level only (no Playwright binary
// in this VM). Synthetic users only. No paired connector exists for these
// users, so POSTs exercise the blocked-snapshot path (422, no row) rather
// than a full diagnostic; the full path is covered by DB tests + the real
// wp-dev integration run documented in docs/woocommerce-checkout-checker.md.
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

test("woo e2e: register + create website", { skip: !BASE }, async () => {
  cookies = jar();
  const email = `woo-e2e-${stamp}@example.com`;
  let r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Woo E2E", email, password: "Password123" },
    cookies,
  });
  assert.ok([200, 201].includes(r.res.status), `sign-up ${r.res.status}: ${r.text.slice(0, 300)}`);
  r = await req("/api/websites", { method: "POST", body: { name: "Shop", url: "https://woo-shop.example.com/" }, cookies });
  assert.equal(r.res.status, 201, r.text.slice(0, 300));
  websiteId = r.json.website.id;
});

test("woo e2e: unauthenticated API access rejected", { skip: !BASE }, async () => {
  let r = await req("/api/woocommerce-diagnostics", { method: "POST", body: { websiteId, symptomCategory: "OTHER", symptomDescription: "x" } });
  assert.equal(r.res.status, 401);
  r = await req("/api/woocommerce-diagnostics");
  assert.equal(r.res.status, 401);
  r = await req("/api/woocommerce-diagnostics/nonexistent-id");
  assert.equal(r.res.status, 401);
  r = await req("/api/woocommerce-diagnostics/snapshot?websiteId=nonexistent");
  assert.equal(r.res.status, 401);
  r = await req("/api/woocommerce-diagnostics/nonexistent-id/ai-analysis");
  assert.equal(r.res.status, 401);
});

test("woo e2e: unconnected website blocks with SNAPSHOT_MISSING and no row", { skip: !BASE }, async () => {
  let r = await req("/api/woocommerce-diagnostics", {
    method: "POST",
    body: { websiteId, symptomCategory: "NO_PAYMENT_METHODS", symptomDescription: "No methods.", checkoutType: "BLOCK", affectedScope: "MULTIPLE" },
    cookies,
  });
  assert.equal(r.res.status, 422, r.text.slice(0, 300));
  assert.equal(r.json.snapshotStatus, "SNAPSHOT_MISSING");
  assert.match(r.json.resyncInstructions, /diagnostic sync/);
  r = await req("/api/woocommerce-diagnostics", { cookies });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.total, 0);
  assert.deepEqual(r.json.diagnostics, []);
});

test("woo e2e: arbitrary client snapshot/payment status rejected (ignored), invalid input rejected", { skip: !BASE }, async () => {
  let r = await req("/api/woocommerce-diagnostics", {
    method: "POST",
    body: {
      websiteId, symptomCategory: "OTHER", symptomDescription: "Forged.",
      snapshot: { schemaVersion: 3, woocommerce: { status: "AVAILABLE" } },
      gateways: [{ id: "fake", enabled: true }], paymentStatus: "succeeded",
      connectorId: "forged", ownerId: "forged",
    },
    cookies,
  });
  assert.equal(r.res.status, 422);
  assert.equal(r.json.snapshotStatus, "SNAPSHOT_MISSING");

  r = await req("/api/woocommerce-diagnostics", {
    method: "POST",
    body: { websiteId, symptomCategory: "NOPE", symptomDescription: "x" },
    cookies,
  });
  assert.equal(r.res.status, 400);
  r = await req("/api/woocommerce-diagnostics", {
    method: "POST",
    body: { websiteId, symptomCategory: "OTHER", symptomDescription: "x".repeat(2001) },
    cookies,
  });
  assert.equal(r.res.status, 400);
  r = await req("/api/woocommerce-diagnostics", {
    method: "POST",
    body: { websiteId, symptomCategory: "OTHER", symptomDescription: "x", checkoutType: "BOGUS" },
    cookies,
  });
  assert.equal(r.res.status, 400);
});

test("woo e2e: another user's website is 404-identical; snapshot view for own unconnected site is missing", { skip: !BASE }, async () => {
  let r = await req("/api/woocommerce-diagnostics", {
    method: "POST",
    body: { websiteId: "nonexistent-website", symptomCategory: "OTHER", symptomDescription: "x" },
    cookies,
  });
  assert.equal(r.res.status, 404);
  r = await req("/api/woocommerce-diagnostics/nonexistent-diagnostic", { cookies });
  assert.equal(r.res.status, 404);
  r = await req("/api/woocommerce-diagnostics/snapshot?websiteId=nonexistent", { cookies });
  assert.equal(r.res.status, 404);
  r = await req("/api/woocommerce-diagnostics/snapshot?websiteId=" + encodeURIComponent(websiteId), { cookies });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.snapshotStatus, "SNAPSHOT_MISSING");
  assert.equal(r.json.snapshot, null);
});

test("woo e2e: tool page loads for a signed-in user", { skip: !BASE }, async () => {
  const res = await fetch(`${BASE}/tools/woocommerce-checkout-checker`, {
    headers: cookies.header(), redirect: "manual",
  });
  assert.equal(res.status, 200, `tool page ${res.status}`);
  const html = await res.text();
  assert.match(html, /WooCommerce Checkout/);
});
