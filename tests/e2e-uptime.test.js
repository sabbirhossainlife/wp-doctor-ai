// Tool 12 HTTP end-to-end tests against a RUNNING server.
// Run: E2E_BASE_URL=http://127.0.0.1:3102 node --test tests/e2e-uptime.test.js
// Skipped when E2E_BASE_URL is unset. HTTP-level only (no browser binary
// in this VM). The loopback website below is BLOCKED by scanner policy
// before any external connection — the manual check truthfully persists
// a BLOCKED check, never a fabricated success. The tick route without a
// configured secret honestly returns 503 SCHEDULER_NOT_CONFIGURED.
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

let cookies, cookiesB, websiteId, monitorId;

test("uptime e2e: register", { skip: !BASE }, async () => {
  cookies = jar();
  const email = `uptime-e2e-${stamp}@example.com`;
  const r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Uptime E2E", email, password: "Password123" },
    cookies,
  });
  assert.ok([200, 201].includes(r.res.status), `sign-up ${r.res.status}: ${r.text.slice(0, 300)}`);
});

test("uptime e2e: unauthenticated API access rejected", { skip: !BASE }, async () => {
  let r = await req("/api/monitors", { method: "POST", body: { websiteId: "x" } });
  assert.equal(r.res.status, 401);
  r = await req("/api/monitors");
  assert.equal(r.res.status, 401);
  r = await req("/api/monitoring/health");
  assert.equal(r.res.status, 401);
  r = await req("/api/monitoring/internal/tick", { method: "POST", body: {} });
  // No tick secret in the test env: 503 honest-unconfigured, or 401 if one is set.
  assert.ok([401, 503].includes(r.res.status), `tick ${r.res.status}`);
  if (r.res.status === 503) assert.equal(r.json.code, "SCHEDULER_NOT_CONFIGURED");
});

test("uptime e2e: create website + monitor", { skip: !BASE }, async () => {
  const w = await req("/api/websites", {
    method: "POST",
    body: { name: "Loopback Site", url: "http://127.0.0.1:8080/" },
    cookies,
  });
  assert.equal(w.res.status, 201, `website ${w.res.status}: ${w.text.slice(0, 300)}`);
  websiteId = w.json.website.id;
  const m = await req("/api/monitors", {
    method: "POST",
    body: { websiteId },
    cookies,
  });
  assert.equal(m.res.status, 201, `monitor ${m.res.status}: ${m.text.slice(0, 300)}`);
  monitorId = m.json.monitor.id;
  assert.equal(m.json.monitor.checkIntervalMinutes, 15);
});

test("uptime e2e: manual check of a policy-blocked target is truthfully BLOCKED", { skip: !BASE }, async () => {
  const r = await req(`/api/monitors/${monitorId}/run-check`, { method: "POST", cookies });
  assert.equal(r.res.status, 200, `run-check ${r.res.status}: ${r.text.slice(0, 300)}`);
  assert.equal(r.json.check.outcome, "BLOCKED");
  assert.equal(r.json.monitor.currentState, "BLOCKED");
  const checks = await req(`/api/monitors/${monitorId}/checks`, { cookies });
  assert.equal(checks.res.status, 200);
  assert.ok(checks.json.checks.some((c) => c.outcome === "BLOCKED"));
});

test("uptime e2e: detail, cross-user 404, and monitoring health", { skip: !BASE }, async () => {
  const d = await req(`/api/monitors/${monitorId}`, { cookies });
  assert.equal(d.res.status, 200);
  assert.equal(d.json.monitor.id, monitorId);
  cookiesB = jar();
  const r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Uptime E2E B", email: `uptime-e2e-b-${stamp}@example.com`, password: "Password123" },
    cookies: cookiesB,
  });
  assert.ok([200, 201].includes(r.res.status));
  const other = await req(`/api/monitors/${monitorId}`, { cookies: cookiesB });
  assert.equal(other.res.status, 404, "another user's monitor must be indistinguishable from missing");
  const health = await req("/api/monitoring/health", { cookies });
  assert.equal(health.res.status, 200);
  assert.equal(health.json.emailConfigured, false);
  assert.equal(health.json.emailStatus, "EMAIL_NOT_CONFIGURED");
});

test("uptime e2e: maintenance window validation + pause/resume", { skip: !BASE }, async () => {
  const bad = await req("/api/maintenance-windows", {
    method: "POST",
    body: { monitorId, title: "Bad", startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date().toISOString(), timezone: "Asia/Dhaka" },
    cookies,
  });
  assert.equal(bad.res.status, 400);
  const good = await req("/api/maintenance-windows", {
    method: "POST",
    body: { monitorId, title: "Deploy", startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now() + 7200000).toISOString(), timezone: "Asia/Dhaka" },
    cookies,
  });
  assert.equal(good.res.status, 201, `window ${good.res.status}: ${good.text.slice(0, 300)}`);
  const paused = await req(`/api/monitors/${monitorId}`, { method: "PATCH", body: { paused: true }, cookies });
  assert.equal(paused.res.status, 200);
  assert.equal(paused.json.monitor.status, "PAUSED");
  const blocked = await req(`/api/monitors/${monitorId}/run-check`, { method: "POST", cookies });
  assert.equal(blocked.res.status, 409);
  const resumed = await req(`/api/monitors/${monitorId}`, { method: "PATCH", body: { paused: false }, cookies });
  assert.equal(resumed.res.status, 200);
});
