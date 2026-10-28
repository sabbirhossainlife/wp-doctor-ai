// HTTP end-to-end tests against a RUNNING server (dev or production build).
// Run: E2E_BASE_URL=http://127.0.0.1:3102 node --test tests/e2e.test.js
// Skipped when E2E_BASE_URL is unset. Uses synthetic users only.
// NOTE: this is HTTP-level E2E, not browser E2E (see README: Playwright
// browser E2E is NOT RUN in this VM — no browser binary download available).
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL;
const stamp = Date.now();

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(path, { method = "GET", body, cookies } = {}) {
  // Better Auth's built-in special rule caps /sign-in and /sign-up at 3
  // requests per 10s per IP, and its in-memory counter only resets after
  // 10s of silence. Space auth calls >10s apart so the flow tests the
  // product, not the limiter (the limiter itself is covered separately).
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
  try { json = JSON.parse(text); } catch { /* non-JSON (redirects) */ }
  return { res, json, text };
}

test("full flow: register, dashboard, website CRUD, logout, protected denied", { skip: !BASE }, async () => {
  const email = `e2e-${stamp}@example.com`;
  const cookies = jar();
  // Register via Better Auth endpoint.
  let r = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "E2E User", email, password: "Password123" },
    cookies,
  });
  assert.ok([200, 201].includes(r.res.status), `sign-up status ${r.res.status}: ${r.text.slice(0, 300)}`);
  // Dashboard requires auth and shows the user.
  r = await req("/dashboard", { cookies });
  assert.equal(r.res.status, 200);
  // React renders "Welcome, <!-- -->E2E User" in HTML; match parts.
  assert.match(r.text, /Welcome,/);
  assert.match(r.text, /E2E User/);
  // Add website.
  r = await req("/api/websites", { method: "POST", body: { name: "Shop", url: "https://Shop.Example.com/" }, cookies });
  assert.equal(r.res.status, 201, r.text.slice(0, 300));
  assert.equal(r.json.website.normalizedUrl, "https://shop.example.com");
  const id = r.json.website.id;
  assert.equal(r.json.website.connectionStatus, "NOT_CONNECTED");
  // Duplicate rejected.
  r = await req("/api/websites", { method: "POST", body: { name: "Dup", url: "https://shop.example.com" }, cookies });
  assert.equal(r.res.status, 409);
  // Bad scheme rejected.
  r = await req("/api/websites", { method: "POST", body: { name: "Bad", url: "ftp://example.com" }, cookies });
  assert.equal(r.res.status, 400);
  // Update name.
  r = await req(`/api/websites/${id}`, { method: "PATCH", body: { name: "Shop Renamed", url: "https://shop.example.com" }, cookies });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.website.name, "Shop Renamed");
  // Delete.
  r = await req(`/api/websites/${id}`, { method: "DELETE", cookies });
  assert.equal(r.res.status, 200);
  // Logout invalidates session: dashboard redirects to /login.
  r = await req("/api/auth/sign-out", { method: "POST", body: {}, cookies });
  assert.ok([200, 302].includes(r.res.status), `sign-out ${r.res.status}`);
  cookies.clear();
  r = await req("/dashboard", { cookies });
  assert.ok([307, 308, 303].includes(r.res.status) || /login/.test(r.text), `after logout dashboard: ${r.res.status}`);
  // Unauthenticated API rejected.
  r = await req("/api/websites", { cookies });
  assert.equal(r.res.status, 401);
});

test("registration validation: duplicate, invalid email, weak password", { skip: !BASE }, async () => {
  const email = `e2e-val-${stamp}@example.com`;
  const cookies = jar();
  let r = await req("/api/auth/sign-up/email", { method: "POST", body: { name: "Val User", email, password: "Password123" }, cookies });
  assert.ok([200, 201].includes(r.res.status), `first sign-up ${r.res.status}: ${r.text.slice(0, 200)}`);
  // Duplicate email must fail, not create a second account.
  r = await req("/api/auth/sign-up/email", { method: "POST", body: { name: "Val User 2", email, password: "Password123" }, cookies: jar() });
  assert.ok([400, 409, 422].includes(r.res.status), `duplicate ${r.res.status}`);
  // Invalid email rejected.
  r = await req("/api/auth/sign-up/email", { method: "POST", body: { name: "Bad", email: "not-an-email", password: "Password123" }, cookies: jar() });
  assert.ok([400, 422].includes(r.res.status), `invalid email ${r.res.status}`);
  // Weak password rejected (below the 8-char minimum).
  r = await req("/api/auth/sign-up/email", { method: "POST", body: { name: "Weak", email: `e2e-weak-${stamp}@example.com`, password: "short" }, cookies: jar() });
  assert.ok([400, 422].includes(r.res.status), `weak password ${r.res.status}`);
});

test("cross-user access is rejected", { skip: !BASE }, async () => {
  const a = jar(); const b = jar();
  const emailA = `e2e-a-${stamp}@example.com`;
  const emailB = `e2e-b-${stamp}@example.com`;
  await req("/api/auth/sign-up/email", { method: "POST", body: { name: "User A", email: emailA, password: "Password123" }, cookies: a });
  await req("/api/auth/sign-up/email", { method: "POST", body: { name: "User B", email: emailB, password: "Password123" }, cookies: b });
  const created = await req("/api/websites", { method: "POST", body: { name: "A Site", url: "https://a-site.example.com" }, cookies: a });
  assert.equal(created.res.status, 201);
  const id = created.json.website.id;
  // B cannot read/update/delete A's website (404, not a leak).
  let r = await req(`/api/websites/${id}`, { cookies: b });
  assert.equal(r.res.status, 404);
  r = await req(`/api/websites/${id}`, { method: "PATCH", body: { name: "Hacked", url: "https://a-site.example.com" }, cookies: b });
  assert.equal(r.res.status, 404);
  r = await req(`/api/websites/${id}`, { method: "DELETE", cookies: b });
  assert.equal(r.res.status, 404);
  // B cannot assign ADMIN via registration: sign up with role field is ignored.
  const c = jar();
  r = await req("/api/auth/sign-up/email", { method: "POST", body: { name: "Sneaky", email: `e2e-c-${stamp}@example.com`, password: "Password123", role: "ADMIN" }, cookies: c });
  assert.ok([200, 201].includes(r.res.status));
  r = await req("/dashboard", { cookies: c });
  assert.match(r.text, /Account role:/);
  assert.match(r.text, /USER/);
  // Cleanup A's site.
  await req(`/api/websites/${id}`, { method: "DELETE", cookies: a });
});

test("login: correct, wrong password, unknown email", { skip: !BASE }, async () => {
  const email = `e2e-login-${stamp}@example.com`;
  const cookies = jar();
  await req("/api/auth/sign-up/email", { method: "POST", body: { name: "Login User", email, password: "Password123" }, cookies });
  cookies.clear();
  let r = await req("/api/auth/sign-in/email", { method: "POST", body: { email, password: "Password123" }, cookies });
  assert.ok([200, 201].includes(r.res.status), `login ${r.res.status}: ${r.text.slice(0, 200)}`);
  const bad = jar();
  r = await req("/api/auth/sign-in/email", { method: "POST", body: { email, password: "WrongPass123" }, cookies: bad });
  assert.ok([400, 401, 403].includes(r.res.status), `wrong password ${r.res.status}`);
  r = await req("/api/auth/sign-in/email", { method: "POST", body: { email: "nobody@example.com", password: "WrongPass123" }, cookies: bad });
  assert.ok([400, 401, 403].includes(r.res.status), `unknown email ${r.res.status}`);
  // Rate-limit verification lives in tests/rate-limit.test.js (run separately):
  // a 100+/min probe would poison this file's own budget if run in-process.
});
