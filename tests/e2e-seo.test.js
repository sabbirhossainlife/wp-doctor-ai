// Tool 11 HTTP end-to-end tests against a RUNNING server.
// Run: E2E_BASE_URL=http://127.0.0.1:3102 node --test tests/e2e-seo.test.js
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

let cookies, diagnosticId;

test("seo e2e: register", { skip: !BASE }, async () => {
  cookies = jar();
  const email = `seo-e2e-${stamp}@example.com`;
  const r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "SEO E2E", email, password: "Password123" },
    cookies,
  });
  assert.ok([200, 201].includes(r.res.status), `sign-up ${r.res.status}: ${r.text.slice(0, 300)}`);
});

test("seo e2e: unauthenticated API access rejected", { skip: !BASE }, async () => {
  let r = await req("/api/seo-diagnostics", { method: "POST", body: { url: "https://example.com/" } });
  assert.equal(r.res.status, 401);
  r = await req("/api/seo-diagnostics");
  assert.equal(r.res.status, 401);
  r = await req("/api/seo-diagnostics/nonexistent-id");
  assert.equal(r.res.status, 401);
});

test("seo e2e: loopback URL is blocked by policy and persists a FAILED report, not a pass", { skip: !BASE }, async () => {
  const r = await req("/api/seo-diagnostics", {
    method: "POST",
    body: { url: "http://127.0.0.1:8080/" },
    cookies,
  });
  assert.equal(r.res.status, 201, `expected 201, got ${r.res.status}: ${r.text.slice(0, 300)}`);
  assert.equal(r.json.diagnostic.executionStatus, "FAILED");
  assert.ok(r.json.diagnostic.findings.some((f) => f.code === "SEO_CHECK_NOT_RUN"));
  diagnosticId = r.json.diagnostic.id;
});

test("seo e2e: detail is own-only and AI is unconfigured (503)", { skip: !BASE }, async () => {
  const r = await req(`/api/seo-diagnostics/${diagnosticId}`, { cookies });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.diagnostic.id, diagnosticId);
  const ai = await req(`/api/seo-diagnostics/${diagnosticId}/ai-analysis`, { method: "POST", body: {}, cookies });
  assert.equal(ai.res.status, 503);
  assert.equal(ai.json.code, "AI_NOT_CONFIGURED");
  const other = await req("/api/seo-diagnostics/nonexistent-id", { cookies });
  assert.equal(other.res.status, 404);
});
