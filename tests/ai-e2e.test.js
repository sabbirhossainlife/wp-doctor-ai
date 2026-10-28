// AI analysis HTTP end-to-end tests against a RUNNING server.
// Run: E2E_BASE_URL=http://localhost:3000 node --test tests/ai-e2e.test.js
// Skipped when E2E_BASE_URL is unset. HTTP-level only (no Playwright binary
// in this VM). Synthetic users only. The server under test has NO live AI
// key configured, so the honest expected outcome is 503 AI_NOT_CONFIGURED
// — never a fabricated analysis. Success-path persistence is covered by
// tests/ai-db.test.js with a mock provider.
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

async function signUp(email, cookies) {
  const r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "AI E2E", email, password: "Password123" },
    cookies,
  });
  assert.ok([200, 201].includes(r.res.status), `sign-up ${r.res.status}: ${r.text.slice(0, 300)}`);
}

test("unauthenticated AI analysis requests are rejected", { skip: !BASE }, async () => {
  const r = await req("/api/scans/some-id/ai-analysis", { method: "POST", body: {} });
  assert.equal(r.res.status, 401);
  const g = await req("/api/scans/some-id/ai-analysis");
  assert.equal(g.res.status, 401);
});

test("AI section renders on the report page, generation honestly reports not-configured, cross-user is 404", { skip: !BASE }, async () => {
  const cookies = jar();
  await signUp(`aie2e-${stamp}@example.com`, cookies);
  // Create a blocked scan via the real scanner (loopback, standard port).
  let r = await req("/api/scans", { method: "POST", body: { url: "http://127.0.0.1/" }, cookies });
  assert.equal(r.res.status, 201, r.text.slice(0, 300));
  const scanId = r.json.scan.id;

  // Report page renders the AI section in the not-configured state, and the
  // deterministic report remains fully readable without AI.
  r = await req(`/tools/error-checker/${scanId}`, { cookies });
  assert.equal(r.res.status, 200);
  assert.match(r.text, /AI explanation/);
  assert.match(r.text, /not configured/);

  // Generation with no live key configured: honest 503, no fake analysis.
  r = await req(`/api/scans/${scanId}/ai-analysis`, { method: "POST", body: {}, cookies });
  assert.equal(r.res.status, 503, r.text.slice(0, 300));
  assert.equal(r.json.code, "AI_NOT_CONFIGURED");
  assert.ok(!r.text.includes("OPENAI_API_KEY"));

  // A second user cannot generate for, or read, this scan's AI analysis.
  const other = jar();
  await signUp(`aie2e-other-${stamp}@example.com`, other);
  r = await req(`/api/scans/${scanId}/ai-analysis`, { method: "POST", body: {}, cookies: other });
  assert.equal(r.res.status, 404);
  r = await req(`/api/scans/${scanId}/ai-analysis`, { cookies: other });
  assert.equal(r.res.status, 404);

  // Invalid scan id is a safe 404, not a server error.
  r = await req("/api/scans/does-not-exist/ai-analysis", { method: "POST", body: {}, cookies });
  assert.equal(r.res.status, 404);

  // After sign-out, the AI endpoint is protected again.
  r = await req("/api/auth/sign-out", { method: "POST", body: {}, cookies });
  assert.ok([200, 204].includes(r.res.status), r.text.slice(0, 200));
  r = await req(`/api/scans/${scanId}/ai-analysis`, { method: "POST", body: {}, cookies });
  assert.equal(r.res.status, 401);
});
