// Tool 08 HTTP end-to-end tests against a RUNNING server.
// Run: E2E_BASE_URL=http://127.0.0.1:3102 node --test tests/e2e-security.test.js
// Skipped when E2E_BASE_URL is unset. HTTP-level only (no browser binary
// in this VM). Only unauthenticated behaviour is asserted here: the
// security endpoints must reject anonymous requests. No scan is run, no
// provider is called, no site is probed by this file.
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL;

test("security e2e: unauthenticated list/create/detail/ai are rejected", { skip: !BASE }, async () => {
  for (const [path, method] of [
    ["/api/security-diagnostics", "GET"],
    ["/api/security-diagnostics", "POST"],
    ["/api/security-diagnostics/nonexistent-id", "GET"],
    ["/api/security-diagnostics/nonexistent-id/ai-analysis", "GET"],
    ["/api/security-diagnostics/nonexistent-id/ai-analysis", "POST"],
  ]) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ websiteId: "x" }) : undefined,
      redirect: "manual",
    });
    assert.equal(res.status, 401, `${method} ${path} should be 401, got ${res.status}`);
  }
});

test("security e2e: tool page redirects anonymous visitors to login", { skip: !BASE }, async () => {
  const res = await fetch(`${BASE}/tools/security-scanner`, { redirect: "manual" });
  assert.ok([307, 308, 302].includes(res.status) || res.status === 401, `expected redirect/401, got ${res.status}`);
});
