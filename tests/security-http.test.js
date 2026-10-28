// Tool 08 passive HTTP observation tests (Milestone 12). All network is a
// fake probe — no live fetch, no DNS, no loopback server needed here. The
// real pinned transport is covered by the M2 scanner regression suite.
import test from "node:test";
import assert from "node:assert/strict";
import { probeHomepage, probeXmlrpc, probeSensitivePaths, SENSITIVE_PATHS } from "../lib/security/http.js";

const SECRET = "SENTINEL_SECRET_XYZ_9f8e7d";

function fakeProbe(routes) {
  const calls = [];
  const probe = async (url, opts = {}) => {
    calls.push(url);
    const hit = routes.find(([prefix]) => url.startsWith(prefix));
    if (!hit) return { status: 404, headers: {}, bodyPreview: null };
    return hit[1](url, opts);
  };
  probe.calls = calls;
  return probe;
}

test("homepage: same-host redirect followed, headers from final response", async () => {
  const probe = fakeProbe([
    ["https://example.com/", (url) => url === "https://example.com/" ? { status: 301, headers: { location: "https://example.com/home" } } : { status: 200, headers: { "strict-transport-security": "max-age=31536000" } }],
  ]);
  const r = await probeHomepage("https://example.com/", { probe });
  assert.equal(r.status, 200);
  assert.equal(r.redirectCount, 1);
  assert.equal(r.crossHostRedirect, false);
  assert.equal(r.headers["strict-transport-security"], "max-age=31536000");
});

test("homepage: cross-host redirect is NOT followed", async () => {
  const probe = fakeProbe([
    ["https://example.com/", () => ({ status: 302, headers: { location: "https://other.example/x" } })],
    ["https://other.example/", () => ({ status: 200, headers: {} })],
  ]);
  const r = await probeHomepage("https://example.com/", { probe });
  assert.equal(r.crossHostRedirect, true);
  assert.ok(!probe.calls.some((u) => u.startsWith("https://other.example/")), "cross-host destination must never be fetched");
});

test("homepage: probe failure is NOT_RUN, never a clean pass", async () => {
  const r = await probeHomepage("https://example.com/", { probe: async () => { throw new Error("boom"); } });
  // probeHomepage catches via the probe returning error? A throwing probe
  // is caught by the outer try/catch in probeHomepage.
  assert.equal(r.status, null);
  assert.ok(r.error);
});

test("xmlrpc: 200 and 405 respond; 404 does not; failure is not-run", async () => {
  assert.equal((await probeXmlrpc("https://example.com/", { probe: async () => ({ status: 200, headers: {} }) })).responds, true);
  assert.equal((await probeXmlrpc("https://example.com/", { probe: async () => ({ status: 405, headers: {} }) })).responds, true);
  assert.equal((await probeXmlrpc("https://example.com/", { probe: async () => ({ status: 404, headers: {} }) })).responds, false);
  const failed = await probeXmlrpc("https://example.com/", { probe: async () => ({ error: "TIMEOUT" }) });
  assert.equal(failed.responds, false);
  assert.equal(failed.error, "TIMEOUT");
});

test("sensitive paths: fixed list only, secret bodies never leak into classifications", async () => {
  const probe = fakeProbe([
    ["https://example.com/.env", () => ({ status: 200, headers: { "content-type": "text/plain" }, bodyPreview: `DB_PASSWORD=${SECRET}\n` })],
    ["https://example.com/.git/HEAD", () => ({ status: 404, headers: {}, bodyPreview: "" })],
    ["https://example.com/wp-config.php.bak", () => ({ status: 200, headers: { "content-type": "text/html" }, bodyPreview: "<html>theme</html>" })],
    ["https://example.com/wp-config.php~", () => ({ status: 403, headers: {}, bodyPreview: "" })],
    ["https://example.com/wp-content/debug.log", () => ({ status: 200, headers: {}, bodyPreview: "PHP Fatal error: x\n" })],
    ["https://example.com/debug.log", () => ({ status: 404, headers: {}, bodyPreview: "" })],
  ]);
  const results = await probeSensitivePaths("https://example.com/", { probe });
  assert.deepEqual(results.map((r) => r.path), [...SENSITIVE_PATHS]);
  assert.equal(results[0].result, "CONFIRMED");
  assert.equal(results[1].result, "NOT_OBSERVED");
  assert.equal(results[2].result, "POSSIBLE_EXPOSURE");
  assert.equal(results[4].result, "CONFIRMED");
  assert.ok(!JSON.stringify(results).includes(SECRET), "no secret may survive classification");
  assert.ok(!JSON.stringify(results).includes("DB_PASSWORD"), "no body fragment may survive classification");
  assert.equal(probe.calls.length, SENSITIVE_PATHS.length, "exactly one probe per fixed path, no crawling");
});

test("sensitive probes request body capture (bounded first-bytes only)", async () => {
  const seen = [];
  const probe = async (url, opts = {}) => { seen.push(opts); return { status: 404, headers: {}, bodyPreview: null }; };
  await probeSensitivePaths("https://example.com/", { probe });
  assert.ok(seen.every((o) => o.captureBody === true));
});
