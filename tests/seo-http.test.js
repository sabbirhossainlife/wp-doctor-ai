// Tool 11 HTTP/engine tests. Fake probes for redirect/robots/sitemap
// logic; one real pinned-transport test against a local HTTP server
// (direct IP pin — no DNS involved) proving the 64 KiB prefix-stop;
// one full-engine test against a local server via the TEST-ONLY testPin
// seam (routes never pass it).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runSeoCheck } from "../lib/seo/engine.js";
import { pinnedRequest } from "../lib/scanner/transport.js";

function fakeProbe(routes) {
  // routes: Map path-or-url -> { status, headers?, bodyPreview? } or fn.
  return async (url) => {
    const key = url;
    const hit = routes[key] ?? routes[new URL(url).pathname] ?? null;
    if (typeof hit === "function") return hit(url);
    if (hit) return { status: hit.status, headers: hit.headers ?? {}, bodyPreview: hit.bodyPreview ?? null, bodyTruncated: hit.bodyTruncated ?? false };
    return { status: 404, headers: {}, bodyPreview: null, bodyTruncated: false };
  };
}

const HEAD_OK = `<html><head><title>Example Shop — Fine Widgets</title>
<meta name="description" content="We sell fine widgets for every home.">
<link rel="canonical" href="https://example.com/"></head><body>hi</body></html>`;
const ROBOTS = `User-agent: *\nDisallow: /wp-admin/\nSitemap: https://example.com/sitemap.xml\n`;
const SITEMAP = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc><lastmod>2026-10-01</lastmod></url></urlset>`;

function okRoutes(extra = {}) {
  return {
    "https://example.com/": { status: 200, headers: { "content-type": "text/html" }, bodyPreview: HEAD_OK },
    "https://example.com/robots.txt": { status: 200, headers: { "content-type": "text/plain" }, bodyPreview: ROBOTS },
    "https://example.com/sitemap.xml": { status: 200, headers: { "content-type": "application/xml" }, bodyPreview: SITEMAP },
    ...extra,
  };
}

test("seo engine: happy path via fake probe", async () => {
  const result = await runSeoCheck("https://example.com/", { probe: fakeProbe(okRoutes()) });
  assert.equal(result.executionStatus, "COMPLETED");
  assert.equal(result.finalUrl, "https://example.com/");
  assert.equal(result.robotsSummary.present, true);
  assert.equal(result.sitemapSummary.status, "OK");
  assert.equal(result.sitemapSummary.homepagePresent, true);
  assert.equal(result.sitemapSummary.entryCount, 1);
  assert.deepEqual(result.spamSignals.keywordCategories, []);
  assert.equal(result.searchConsoleStatus, "NOT_CONFIGURED");
  assert.ok(result.findings.some((f) => f.code === "SEARCH_CONSOLE_NOT_CONFIGURED"));
  assert.ok(!result.findings.some((f) => f.code === "SEO_TITLE_MISSING"));
  // No body content persisted in summaries.
  assert.ok(!JSON.stringify(result).includes("We sell fine widgets"));
});

test("seo engine: cross-host redirect stops homepage checks but robots/sitemap still run", async () => {
  const routes = okRoutes({
    "https://example.com/": { status: 301, headers: { location: "https://other.example/" } },
  });
  const result = await runSeoCheck("https://example.com/", { probe: fakeProbe(routes) });
  assert.equal(result.homepageSummary.crossHostRedirect, true);
  assert.equal(result.homepageSummary.crossHostDestinationHost, "other.example");
  assert.ok(result.findings.some((f) => f.code === "UNEXPECTED_REDIRECT"));
  // robots/sitemap still evaluated against the REQUESTED origin.
  assert.equal(result.robotsSummary.present, true);
  assert.equal(result.sitemapSummary.status, "OK");
  assert.equal(result.executionStatus, "PARTIAL");
});

test("seo engine: same-host redirect chain counted; downgrade blocked", async () => {
  const routes = okRoutes({
    "https://example.com/": { status: 301, headers: { location: "https://example.com/home" } },
    "https://example.com/home": { status: 200, headers: { "content-type": "text/html" }, bodyPreview: HEAD_OK },
  });
  const result = await runSeoCheck("https://example.com/", { probe: fakeProbe(routes) });
  assert.equal(result.homepageSummary.redirectCount, 1);
  assert.ok(result.findings.some((f) => f.code === "REDIRECT_CHAIN_NOTE"));

  const down = await runSeoCheck("https://example.com/", {
    probe: fakeProbe(okRoutes({
      "https://example.com/": { status: 301, headers: { location: "http://example.com/" } },
    })),
  });
  assert.equal(down.homepageSummary.terminalError, "DOWNGRADE_BLOCKED");
  assert.ok(down.findings.some((f) => f.code === "REDIRECT_CHAIN_NOTE"));
});

test("seo engine: robots missing + sitemap missing are info findings, not failures", async () => {
  const routes = {
    "https://example.com/": { status: 200, headers: {}, bodyPreview: HEAD_OK },
    "https://example.com/robots.txt": { status: 404, headers: {}, bodyPreview: null },
    "https://example.com/sitemap.xml": { status: 404, headers: {}, bodyPreview: null },
  };
  const result = await runSeoCheck("https://example.com/", { probe: fakeProbe(routes) });
  assert.ok(result.findings.some((f) => f.code === "ROBOTS_TXT_MISSING"));
  assert.ok(result.findings.some((f) => f.code === "SITEMAP_MISSING"));
  assert.equal(result.executionStatus, "COMPLETED");
});

test("seo engine: sitemap index fans out to children (bounded)", async () => {
  const index = `<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap><sitemap><loc>https://example.com/b.xml</loc></sitemap></sitemapindex>`;
  const child = (loc) => `<?xml version="1.0"?><urlset><url><loc>${loc}</loc></url></urlset>`;
  const routes = okRoutes({
    "https://example.com/sitemap.xml": { status: 200, headers: {}, bodyPreview: index },
    "https://example.com/a.xml": { status: 200, headers: {}, bodyPreview: child("https://example.com/") },
    "https://example.com/b.xml": { status: 200, headers: {}, bodyPreview: child("https://example.com/about") },
  });
  // robots.txt lists no sitemap here? okRoutes robots lists sitemap.xml,
  // so the index is reached via robots + conventional (deduped).
  const result = await runSeoCheck("https://example.com/", { probe: fakeProbe(routes) });
  assert.equal(result.sitemapSummary.status, "OK");
  assert.equal(result.sitemapSummary.sitemapsChecked, 3);
  assert.equal(result.sitemapSummary.entryCount, 2);
  assert.equal(result.sitemapSummary.homepagePresent, true);
});

test("seo engine: spam keyword + noindex + robots-block produce heuristic/high findings", async () => {
  const head = `<html><head><title>Cheap casino deals</title><meta name="robots" content="noindex"></head><body></body></html>`;
  const robots = `User-agent: *\nDisallow: /\n`;
  const routes = {
    "https://example.com/": { status: 200, headers: {}, bodyPreview: head },
    "https://example.com/robots.txt": { status: 200, headers: {}, bodyPreview: robots },
    "https://example.com/sitemap.xml": { status: 404, headers: {}, bodyPreview: null },
  };
  const result = await runSeoCheck("https://example.com/", { probe: fakeProbe(routes) });
  const codes = result.findings.map((f) => f.code);
  assert.ok(codes.includes("META_ROBOTS_NOINDEX"));
  assert.ok(codes.includes("ROBOTS_BLOCKS_HOMEPAGE"));
  assert.ok(codes.includes("SPAM_KEYWORD_INDICATOR"));
  assert.deepEqual(result.spamSignals.keywordCategories, ["gambling"]);
  // Category label stored; matched wording is NOT stored anywhere.
  assert.ok(!JSON.stringify(result.spamSignals).includes("casino"));
});

test("seo transport: stopAfterCaptureBytes resolves on a >64 KiB body with the prefix only", async () => {
  const bigHead = `<html><head><title>Big Page Title Here</title></head><body>${"x".repeat(200 * 1024)}</body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(bigHead);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const res = await pinnedRequest({
      protocol: "http:", hostname: "localhost", ip: "127.0.0.1", family: 4, port,
      path: "/", timeoutMs: 10000, maxBytes: 256 * 1024,
      captureBodyBytes: 64 * 1024, stopAfterCaptureBytes: 64 * 1024,
    });
    assert.equal(res.status, 200);
    assert.equal(res.bodyTruncated, true);
    assert.ok(res.bodyPreview.includes("<title>Big Page Title Here</title>"));
    assert.ok(res.bodyPreview.length <= 64 * 1024 + 100);
    // Without the stop flag, the same body is fully counted (M2 behaviour).
    const full = await pinnedRequest({
      protocol: "http:", hostname: "localhost", ip: "127.0.0.1", family: 4, port,
      path: "/", timeoutMs: 10000, maxBytes: 256 * 1024,
    });
    assert.equal(full.bodyBytes, Buffer.byteLength(bigHead));
    assert.equal(full.bodyTruncated, false);
    assert.equal(full.bodyPreview, undefined);
  } finally {
    server.close();
  }
});

test("seo engine: full run against a local server via the test-only pin seam", async () => {
  // The scanner policy allows only ports 80/443, so this test binds port
  // 80 (skipped if unavailable). The target hostname is public-looking;
  // testPin maps it to loopback in-process (routes never do this).
  const server = http.createServer((req, res) => {
    if (req.url === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end("User-agent: *\nDisallow: /wp-admin/\n"); return; }
    if (req.url === "/sitemap.xml") { res.writeHead(200, { "content-type": "application/xml" }); res.end(SITEMAP); return; }
    res.writeHead(200, { "content-type": "text/html" }); res.end(HEAD_OK);
  });
  let bound = false;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(80, "127.0.0.1", () => { bound = true; resolve(); });
    });
  } catch {
    server.close();
    console.log("seo engine local-server test skipped: port 80 unavailable");
    return;
  }
  try {
    const result = await runSeoCheck("http://seo-test.example/", {
      testPin: () => ({ address: "127.0.0.1", family: 4 }),
    });
    assert.equal(result.executionStatus, "COMPLETED");
    assert.equal(result.homepageSummary.finalStatus, 200);
    assert.equal(result.robotsSummary.present, true);
    assert.equal(result.sitemapSummary.status, "OK");
    assert.equal(result.sitemapSummary.entryCount, 1);
  } finally {
    server.close();
  }
});
