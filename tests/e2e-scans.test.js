// Tool 01 HTTP end-to-end tests against a RUNNING server.
// Run: E2E_BASE_URL=http://127.0.0.1:3102 node --test tests/e2e-scans.test.js
// Skipped when E2E_BASE_URL is unset. HTTP-level only (no Playwright binary
// in this VM). Synthetic users only. The live scan case uses a loopback URL,
// which the real scanner must BLOCK before any connection — that exercises
// the full auth -> API -> scanner -> persistence -> history chain with the
// production scanner, without depending on external network access.
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
    clear() { cookie = ""; },
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

async function signUp(email, cookies) {
  const r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Scan E2E", email, password: "Password123" },
    cookies,
  });
  assert.ok([200, 201].includes(r.res.status), `sign-up ${r.res.status}: ${r.text.slice(0, 300)}`);
}

test("unauthenticated scan API access is rejected", { skip: !BASE }, async () => {
  let r = await req("/api/scans", { method: "POST", body: { url: "https://example.com/" } });
  assert.equal(r.res.status, 401);
  r = await req("/api/scans");
  assert.equal(r.res.status, 401);
  r = await req("/api/scans/nonexistent-id");
  assert.equal(r.res.status, 401);
});

test("tool flow: page renders, loopback scan is blocked + persisted, history + report + cross-user 404", { skip: !BASE }, async () => {
  const cookies = jar();
  await signUp(`scane2e-${stamp}@example.com`, cookies);

  // Tool page renders with a labelled URL input and Scan action.
  let r = await req("/tools/error-checker", { cookies });
  assert.equal(r.res.status, 200);
  assert.match(r.text, /Website Error Checker/);
  assert.match(r.text, /scan-url/);
  assert.match(r.text, /Scan website/);

  // Fresh user's history page shows the empty state.
  r = await req("/tools/error-checker/history", { cookies });
  assert.equal(r.res.status, 200);
  assert.match(r.text, /No scans yet/);

  // Submit a loopback URL on the standard port: real scanner must block it
  // (PROHIBITED_DESTINATION) before connecting.
  r = await req("/api/scans", { method: "POST", body: { url: "http://127.0.0.1/" }, cookies });
  assert.equal(r.res.status, 201, r.text.slice(0, 300));
  assert.equal(r.json.scan.executionStatus, "BLOCKED");
  assert.equal(r.json.scan.diagnosticOutcome, "BLOCKED_BY_SECURITY_POLICY");
  assert.equal(r.json.scan.errorCode, "PROHIBITED_DESTINATION");
  const scanId = r.json.scan.id;

  // A loopback URL on a non-standard port is blocked by the port policy
  // first (still BLOCKED, never connected).
  r = await req("/api/scans", { method: "POST", body: { url: "http://127.0.0.1:9999/" }, cookies });
  assert.equal(r.res.status, 201, r.text.slice(0, 300));
  assert.equal(r.json.scan.executionStatus, "BLOCKED");
  assert.equal(r.json.scan.errorCode, "UNSUPPORTED_PORT");

  // Client-supplied ownership fields are ignored: the scan belongs to the
  // session user (proven by the cross-user check below, not by this field).
  r = await req("/api/scans", { method: "POST", body: { url: "https://example.com/", userId: "someone-else" }, cookies });
  assert.ok([201, 429].includes(r.res.status), r.text.slice(0, 300));

  // History now lists the blocked scan; report page shows it.
  r = await req("/tools/error-checker/history", { cookies });
  assert.equal(r.res.status, 200);
  assert.match(r.text, /127\.0\.0\.1/);
  r = await req(`/tools/error-checker/${scanId}`, { cookies });
  assert.equal(r.res.status, 200);
  assert.match(r.text, /Scan report/);
  assert.match(r.text, /PROHIBITED_DESTINATION/);

  // API detail for the same scan works for the owner.
  r = await req(`/api/scans/${scanId}`, { cookies });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.scan.id, scanId);

  // Another user cannot see it: 404, not a leak and not a distinguishable error.
  const cookiesB = jar();
  await signUp(`scane2e-b-${stamp}@example.com`, cookiesB);
  r = await req(`/api/scans/${scanId}`, { cookies: cookiesB });
  assert.equal(r.res.status, 404);
  r = await req(`/tools/error-checker/${scanId}`, { cookies: cookiesB });
  assert.equal(r.res.status, 404);

  // Nonexistent id is also 404.
  r = await req("/api/scans/does-not-exist", { cookies });
  assert.equal(r.res.status, 404);

  // Pagination parameters are validated/clamped, not trusted blindly.
  r = await req("/api/scans?page=1&pageSize=1000", { cookies });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.pageSize, 100);
  assert.ok(r.json.total >= 1);

  // Sign out, then protected endpoints deny access.
  r = await req("/api/auth/sign-out", { method: "POST", body: {}, cookies });
  assert.ok([200, 201].includes(r.res.status), r.text.slice(0, 200));
  cookies.clear();
  r = await req("/api/scans", { cookies });
  assert.equal(r.res.status, 401);
  r = await req("/tools/error-checker", { cookies });
  assert.ok([307, 303, 302].includes(r.res.status), `expected redirect to login, got ${r.res.status}`);
});
