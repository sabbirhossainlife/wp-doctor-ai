// Tool 11 rule tests (pure engine inputs — no network).
import test from "node:test";
import assert from "node:assert/strict";
import { runSeoRules, seoPluginSummary } from "../lib/seo/rules.js";

function base(overrides = {}) {
  return {
    homepage: {
      finalUrl: "https://example.com/", finalStatus: 200, redirectCount: 0,
      crossHostRedirect: false, crossHostDestinationHost: null, terminalError: null,
      chain: [], headers: {}, error: null,
    },
    head: {
      headComplete: true,
      title: { present: true, value: "Example Shop — Fine Widgets for Homes", length: 38, empty: false },
      description: { present: true, value: "We sell fine widgets for every home, shipped fast.", length: 50, empty: false },
      robotsTokens: ["index", "follow"],
      canonical: { present: true, value: "https://example.com/" },
      og: { title: true, description: true, image: true },
      hreflangCount: 0,
      externalLinkCount: 0, totalLinkCount: 0, hiddenLinkCount: 0,
    },
    robots: { present: true, status: 200, sitemapUrls: [], crossHostSitemapCount: 0, blocksHomepage: false, blockingRule: null, malformedLineNumbers: [], googlebotGroupPresent: false },
    sitemap: { status: "OK", checkedSources: [], sitemapsChecked: 1, entryCount: 5, homepagePresent: true, hasLastmod: true, truncated: false, error: null },
    seoPlugin: { status: "SEO_PLUGIN_ACTIVE", plugins: [], activeSlugs: ["rank-math"] },
    searchConsoleStatus: "NOT_CONFIGURED",
    spam: { keywordCategories: [], externalLinkCount: 0, totalLinkCount: 0, hiddenLinkCount: 0 },
    ...overrides,
  };
}

function codes(findings) {
  return findings.map((f) => f.code);
}

test("seo rules: clean evidence yields only the Search Console info finding", () => {
  const findings = runSeoRules(base());
  assert.deepEqual(codes(findings), ["SEARCH_CONSOLE_NOT_CONFIGURED"]);
  // Never a clean/indexed/spam-free badge claim: the only finding states
  // index status is UNKNOWN (negation phrasing like "not proof ... is
  // indexed" is the honest caveat, not a claim).
  for (const f of findings) {
    assert.ok(!/site is (seo-clean|spam-free|fully indexed)/i.test(`${f.title} ${f.explanation}`));
  }
  assert.ok(/UNKNOWN/i.test(findings[0].explanation));
});

test("seo rules: meta noindex is HIGH severity, observed, never a deindex verdict", () => {
  const findings = runSeoRules(base({ head: { ...base().head, robotsTokens: ["noindex", "follow"] } }));
  const f = findings.find((x) => x.code === "META_ROBOTS_NOINDEX");
  assert.ok(f);
  assert.equal(f.severity, "HIGH");
  assert.equal(f.confidence, "HIGH");
  assert.equal(f.evidenceStatus, "OBSERVED");
  assert.ok(/SIGNAL/i.test(f.explanation));
  // The explanation must carry the negation caveat, not a deindex claim.
  assert.ok(/not proof the page is deindexed/i.test(f.explanation));
});

test("seo rules: X-Robots-Tag noindex + missing title/description", () => {
  const input = base();
  input.homepage.headers = { "x-robots-tag": "noindex" };
  input.head.title = { present: false, value: null, length: 0, empty: false };
  input.head.description = { present: false, value: null, length: 0, empty: false };
  const findings = runSeoRules(input);
  assert.ok(codes(findings).includes("X_ROBOTS_NOINDEX"));
  assert.ok(codes(findings).includes("SEO_TITLE_MISSING"));
  assert.ok(codes(findings).includes("META_DESCRIPTION_MISSING"));
});

test("seo rules: cross-host canonical is MEDIUM; missing canonical is LOW", () => {
  const cross = runSeoRules(base({ head: { ...base().head, canonical: { present: true, value: "https://other.example/" } } }));
  const f = cross.find((x) => x.code === "CANONICAL_MISMATCH");
  assert.ok(f);
  assert.equal(f.severity, "MEDIUM");
  const missing = runSeoRules(base({ head: { ...base().head, canonical: { present: false, value: null } } }));
  assert.equal(missing.find((x) => x.code === "CANONICAL_MISSING").severity, "LOW");
});

test("seo rules: robots blocks homepage HIGH; missing robots LOW info", () => {
  const blocked = runSeoRules(base({ robots: { ...base().robots, blocksHomepage: true, blockingRule: "/" } }));
  assert.equal(blocked.find((x) => x.code === "ROBOTS_BLOCKS_HOMEPAGE").severity, "HIGH");
  const missing = runSeoRules(base({ robots: { ...base().robots, present: false, status: 404 } }));
  const f = missing.find((x) => x.code === "ROBOTS_TXT_MISSING");
  assert.ok(f);
  assert.equal(f.severity, "LOW");
});

test("seo rules: sitemap states map to distinct codes; absence is not an indexing verdict", () => {
  assert.ok(codes(runSeoRules(base({ sitemap: { status: "MISSING" } }))).includes("SITEMAP_MISSING"));
  assert.ok(codes(runSeoRules(base({ sitemap: { status: "UNREACHABLE", error: "CONNECTION_FAILURE" } }))).includes("SITEMAP_UNREACHABLE"));
  assert.ok(codes(runSeoRules(base({ sitemap: { status: "MALFORMED", error: "UNRECOGNISED_ROOT" } }))).includes("SITEMAP_MALFORMED"));
  const absent = runSeoRules(base({ sitemap: { ...base().sitemap, homepagePresent: false } }));
  const f = absent.find((x) => x.code === "HOMEPAGE_NOT_IN_CHECKED_SITEMAPS");
  assert.ok(f);
  assert.ok(/NOT a claim that the page is unindexed/i.test(f.explanation));
});

test("seo rules: cross-host redirect flagged for review, never malicious", () => {
  const findings = runSeoRules(base({
    homepage: { ...base().homepage, crossHostRedirect: true, crossHostDestinationHost: "other.example", redirectCount: 1 },
  }));
  const f = findings.find((x) => x.code === "UNEXPECTED_REDIRECT");
  assert.ok(f);
  assert.equal(f.severity, "MEDIUM");
  assert.ok(!/malicious/i.test(f.title));
  assert.ok(/does not prove anything malicious/i.test(f.explanation));
});

test("seo rules: spam indicators are LOW-confidence heuristics, never confirmed spam", () => {
  const one = runSeoRules(base({ spam: { keywordCategories: ["gambling"], externalLinkCount: 0, totalLinkCount: 0, hiddenLinkCount: 0 } }));
  const f = one.find((x) => x.code === "SPAM_KEYWORD_INDICATOR");
  assert.ok(f);
  assert.equal(f.confidence, "LOW");
  assert.equal(f.evidenceStatus, "HEURISTIC_INDICATOR");
  assert.ok(/NOT confirmed SEO spam/i.test(f.explanation));
  const two = runSeoRules(base({ spam: { keywordCategories: ["gambling", "loans"], externalLinkCount: 0, totalLinkCount: 0, hiddenLinkCount: 0 } }));
  assert.equal(two.find((x) => x.code === "SPAM_KEYWORD_INDICATOR").severity, "MEDIUM");
  const links = runSeoRules(base({ spam: { keywordCategories: [], externalLinkCount: 25, totalLinkCount: 30, hiddenLinkCount: 0 } }));
  assert.ok(codes(links).includes("SUSPICIOUS_OUTBOUND_LINK_INDICATOR"));
  const hidden = runSeoRules(base({ spam: { keywordCategories: [], externalLinkCount: 1, totalLinkCount: 2, hiddenLinkCount: 1 } }));
  assert.ok(codes(hidden).includes("SUSPICIOUS_OUTBOUND_LINK_INDICATOR"));
});

test("seo rules: URL-only plugin evidence is insufficient, never invented", () => {
  const findings = runSeoRules(base({ seoPlugin: { status: "NOT_CHECKED", reason: "URL_ONLY", plugins: [] } }));
  const f = findings.find((x) => x.code === "SEO_EVIDENCE_INSUFFICIENT");
  assert.ok(f);
  assert.ok(/URL-only/i.test(f.explanation));
});

test("seo rules: homepage fetch failure yields SEO_CHECK_NOT_RUN, no invented head findings", () => {
  const findings = runSeoRules(base({
    homepage: { ...base().homepage, error: "CONNECTION_FAILURE", terminalError: "CONNECTION_FAILURE", finalStatus: null },
    head: null,
  }));
  assert.ok(codes(findings).includes("SEO_CHECK_NOT_RUN"));
  assert.ok(!codes(findings).includes("SEO_TITLE_MISSING"));
});

test("seo rules: SEO_SNAPSHOT_STALE is never emitted (stale runs persist no row)", () => {
  const findings = runSeoRules(base());
  assert.ok(!codes(findings).includes("SEO_SNAPSHOT_STALE"));
});

test("seo plugin summary: canonical slugs only, names never identify", () => {
  const snapshot = {
    plugins: [
      { slug: "rank-math", version: "1.0", active: true },
      { slug: "wordpress-seo", version: "2.0", active: false },
      { slug: "some-plugin", version: "1.0", active: true },
    ],
  };
  const s = seoPluginSummary(snapshot);
  assert.equal(s.status, "SEO_PLUGIN_ACTIVE");
  assert.deepEqual(s.activeSlugs, ["rank-math"]);
  assert.equal(s.plugins.find((p) => p.slug === "wordpress-seo").status, "INSTALLED_INACTIVE");
  assert.equal(s.plugins.find((p) => p.slug === "seopress").status, "NOT_INSTALLED");
  // v1-style snapshot (no plugins list): NOT_CHECKED, never name-matched.
  assert.equal(seoPluginSummary({ activePlugins: [{ name: "Yoast SEO", version: "1" }] }).status, "NOT_CHECKED");
  assert.equal(seoPluginSummary(null).status, "NOT_CHECKED");
});
