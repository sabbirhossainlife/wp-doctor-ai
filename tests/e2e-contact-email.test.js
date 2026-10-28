// Tool 07 HTTP end-to-end tests against a RUNNING server.
// Run: E2E_BASE_URL=http://127.0.0.1:3102 node --test tests/e2e-contact-email.test.js
// Skipped when E2E_BASE_URL is unset. HTTP-level only (no browser binary
// in this VM). The POST below targets a loopback URL and supplies no
// email domain, so no external DNS is needed: the default-domain rule
// rejects the loopback host and DNS checks report NOT_CHECKED. No email
// is sent and no form is submitted by this test or by the endpoint.
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

test("contact-email e2e: register", { skip: !BASE }, async () => {
  cookies = jar();
  const email = `ce-e2e-${stamp}@example.com`;
  const r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "CE E2E", email, password: "Password123" },
    cookies,
  });
  assert.ok([200, 201].includes(r.res.status), `sign-up ${r.res.status}: ${r.text.slice(0, 300)}`);
});

test("contact-email e2e: unauthenticated API access rejected", { skip: !BASE }, async () => {
  let r = await req("/api/contact-email-diagnostics", { method: "POST", body: { url: "https://example.com/" } });
  assert.equal(r.res.status, 401);
  r = await req("/api/contact-email-diagnostics");
  assert.equal(r.res.status, 401);
  r = await req("/api/contact-email-diagnostics/nonexistent-id");
  assert.equal(r.res.status, 401);
});

test("contact-email e2e: URL-only loopback run completes without external DNS", { skip: !BASE }, async () => {
  const r = await req("/api/contact-email-diagnostics", {
    method: "POST",
    body: { url: "http://127.0.0.1:8080/" },
    cookies,
  });
  assert.equal(r.res.status, 201, `POST ${r.res.status}: ${r.text.slice(0, 300)}`);
  assert.equal(r.json.diagnostic.executionStatus, "COMPLETED");
  assert.equal(r.json.diagnostic.sanitizedEmailDomain, null);
  const codes = r.json.diagnostic.findings.map((f) => f.code);
  assert.ok(codes.includes("EMAIL_EVIDENCE_INSUFFICIENT"));
  assert.ok(codes.includes("DELIVERY_NOT_VERIFIED"));
  const read = await req(`/api/contact-email-diagnostics/${r.json.diagnostic.id}`, { cookies });
  assert.equal(read.res.status, 200);
  const ai = await req(`/api/contact-email-diagnostics/${r.json.diagnostic.id}/ai-analysis`, {
    method: "POST", body: {}, cookies,
  });
  assert.equal(ai.res.status, 503, "AI unconfigured in test env must return 503, deterministic report stands alone");
  assert.equal(ai.json.code, "AI_NOT_CONFIGURED");
});
