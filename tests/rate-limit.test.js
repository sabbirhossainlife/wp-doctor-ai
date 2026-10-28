// Rate-limit probe — RUN SEPARATELY from tests/e2e.test.js:
//   E2E_BASE_URL=http://localhost:3000 node --test tests/rate-limit.test.js
// Verifies Better Auth's built-in SPECIAL rule (found in the installed
// library source): /sign-in and /sign-up are capped at 3 requests per 10s
// per IP, overriding the general 100/min rule. So 429 must appear within
// the first few rapid attempts. Skipped when E2E_BASE_URL is unset.
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE_URL;

test("auth special rule returns 429 after 3 rapid sign-ins", { skip: !BASE }, async () => {
  let saw429 = false;
  let attempts = 0;
  for (let i = 0; i < 8 && !saw429; i++) {
    attempts++;
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ email: "nobody@example.com", password: "WrongPass123" }),
    });
    if (res.status === 429) saw429 = true;
    await res.text();
  }
  console.log(`rate-limit probe: attempts=${attempts} 429 observed=${saw429}`);
  assert.equal(saw429, true, "expected 429 within 8 rapid sign-in attempts");
});
