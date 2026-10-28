// Tool 06 HTTP end-to-end tests against a RUNNING server.
// Run: E2E_BASE_URL=http://127.0.0.1:3102 node --test tests/e2e-ssl.test.js
// Skipped when E2E_BASE_URL is unset. HTTP-level only (no browser binary
// in this VM). The POST below targets a loopback address, which the
// engine BLOCKS before any external connection, and AI is unconfigured
// in the test env (503 expected).
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

let cookies, cookiesB, diagnosticId;

test("ssl e2e: register", { skip: !BASE }, async () => {
  cookies = jar();
  const email = `ssl-e2e-${stamp}@example.com`;
  const r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "SSL E2E", email, password: "Password123" },
    cookies,
  });
  assert.ok([200, 201].includes(r.res.status), `sign-up ${r.res.status}: ${r.text.slice(0, 300)}`);
});

test("ssl e2e: unauthenticated API access rejected", { skip: !BASE }, async () => {
  let r = await req("/api/ssl-redirect-diagnostics", { method: "POST", body: { url: "https://example.com/" } });
  assert.equal(r.res.status, 401);
  r = await req("/api/ssl-redirect-diagnostics");
  assert.equal(r.res.status, 401);
  r = await req("/api/ssl-redirect-diagnostics/nonexistent-id");
  assert.equal(r.res.status, 401);
});

test("ssl e2e: loopback target BLOCKED with a persisted report; client cert results ignored", { skip: !BASE }, async () => {
  const r = await req("/api/ssl-redirect-diagnostics", {
    method: "POST",
    body: { url: "http://127.0.0.1/", tlsOutcome: { verified: true }, findings: [{ code: "FAKE" }] },
    cookies,
  });
  assert.equal(r.res.status, 201, r.text.slice(0, 300));
  assert.equal(r.json.diagnostic.executionStatus, "BLOCKED");
  assert.ok(!JSON.stringify(r.json).includes("FAKE"));
  diagnosticId = r.json.diagnostic.id;
});

test("ssl e2e: invalid input rejected; list + detail work; other user gets 404; AI unconfigured 503", { skip: !BASE }, async () => {
  let r = await req("/api/ssl-redirect-diagnostics", {
    method: "POST",
    body: { url: "" },
    cookies,
  });
  assert.equal(r.res.status, 400);

  r = await req("/api/ssl-redirect-diagnostics", { cookies });
  assert.equal(r.res.status, 200);
  assert.ok(r.json.total >= 1);
  assert.ok(r.json.diagnostics.some((d) => d.id === diagnosticId));

  r = await req(`/api/ssl-redirect-diagnostics/${diagnosticId}`, { cookies });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.diagnostic.id, diagnosticId);

  cookiesB = jar();
  const emailB = `ssl-e2e-b-${stamp}@example.com`;
  let rb = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "SSL E2E B", email: emailB, password: "Password123" },
    cookies: cookiesB,
  });
  assert.ok([200, 201].includes(rb.res.status), rb.text.slice(0, 300));
  rb = await req(`/api/ssl-redirect-diagnostics/${diagnosticId}`, { cookies: cookiesB });
  assert.equal(rb.res.status, 404);

  r = await req(`/api/ssl-redirect-diagnostics/${diagnosticId}/ai-analysis`, { method: "POST", body: {}, cookies });
  assert.ok([503, 429, 502].includes(r.res.status), r.text.slice(0, 300));
  if (r.res.status === 503) assert.equal(r.json.code, "AI_NOT_CONFIGURED");
});
