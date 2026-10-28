// Tool 11 parsing tests (fixtures only — no network, no live site).
import test from "node:test";
import assert from "node:assert/strict";
import { parseHead, parseRobots, parseSitemap, homepageInUrls, matchSpamCategories } from "../lib/seo/parse.js";

const HEAD = `<!doctype html><html><head>
<title>My Shop — Best Widgets</title>
<meta name="description" content="We sell fine widgets for every home.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://example.com/">
<meta property="og:title" content="My Shop">
<meta property="og:image" content="https://example.com/og.png">
<link rel="alternate" hreflang="en" href="https://example.com/">
<link rel="alternate" hreflang="bn" href="https://example.com/bn/">
</head><body><a href="https://other.example/x">partner</a><a href="/about">about</a></body></html>`;

test("seo parseHead: title, description, robots, canonical, og, hreflang", () => {
  const h = parseHead(HEAD, { pageHost: "example.com" });
  assert.equal(h.headComplete, true);
  assert.equal(h.title.present, true);
  assert.equal(h.title.value, "My Shop — Best Widgets");
  assert.equal(h.description.present, true);
  assert.deepEqual(h.robotsTokens, ["index", "follow"]);
  assert.equal(h.canonical.value, "https://example.com/");
  assert.equal(h.og.title, true);
  assert.equal(h.og.description, false);
  assert.equal(h.og.image, true);
  assert.equal(h.hreflangCount, 2);
  assert.equal(h.externalLinkCount, 1);
  assert.equal(h.totalLinkCount, 2);
});

test("seo parseHead: missing title/description, noindex tokens, truncated prefix", () => {
  const h = parseHead(`<html><head><meta name="robots" content="noindex, nofollow">`, { pageHost: "example.com" });
  assert.equal(h.headComplete, false);
  assert.equal(h.title.present, false);
  assert.equal(h.description.present, false);
  assert.deepEqual(h.robotsTokens, ["noindex", "nofollow"]);
  assert.equal(h.canonical.present, false);
});

test("seo parseHead: hidden external link counted, same-host link not external", () => {
  const html = `<head><title>T</title></head><body>
    <a href="https://evil.example/x" style="display:none">x</a>
    <a href="https://example.com/ok">ok</a></body>`;
  const h = parseHead(html, { pageHost: "example.com" });
  assert.equal(h.externalLinkCount, 1);
  assert.equal(h.hiddenLinkCount, 1);
});

test("seo parseRobots: star group blocks homepage, sitemap lines, googlebot group", () => {
  const txt = `User-agent: *
Disallow: /wp-admin/
Disallow: /
Sitemap: https://example.com/sitemap.xml
Sitemap: https://other.example/sitemap.xml
User-agent: googlebot
Disallow: /private/
BadLineWithoutColon
`;
  const r = parseRobots(txt, { siteHost: "example.com" });
  assert.equal(r.present, true);
  assert.equal(r.blocksHomepage, true);
  assert.equal(r.blockingRule, "/");
  assert.deepEqual(r.sitemapUrls, ["https://example.com/sitemap.xml"]);
  assert.equal(r.crossHostSitemapCount, 1);
  assert.equal(r.googlebotGroupPresent, true);
  assert.deepEqual(r.malformedLineNumbers, [8]);
});

test("seo parseRobots: empty Disallow allows; longer Allow wins", () => {
  const r = parseRobots("User-agent: *\nDisallow:\n", { siteHost: "example.com" });
  assert.equal(r.blocksHomepage, false);
  const r2 = parseRobots("User-agent: *\nDisallow: /\nAllow: /\n", { siteHost: "example.com" });
  // RFC 9309: on a longest-match tie, Allow wins.
  assert.equal(r2.blocksHomepage, false);
  const r3 = parseRobots("User-agent: *\nDisallow: /x\nAllow: /x/y\n", { siteHost: "example.com" });
  assert.equal(r3.blocksHomepage, false);
});

test("seo parseRobots: rules for other agents do not apply to star", () => {
  const r = parseRobots("User-agent: bingbot\nDisallow: /\n", { siteHost: "example.com" });
  assert.equal(r.blocksHomepage, false);
  assert.deepEqual(r.disallowsStar, []);
});

test("seo parseSitemap: urlset, index, malformed, homepage presence", () => {
  const urlset = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://example.com/</loc><lastmod>2026-10-01</lastmod></url>
    <url><loc>https://example.com/about</loc></url></urlset>`;
  const p = parseSitemap(urlset);
  assert.equal(p.malformed, false);
  assert.equal(p.isIndex, false);
  assert.equal(p.entryCount, 2);
  assert.equal(p.hasLastmod, true);
  assert.equal(homepageInUrls("https://example.com/", p.urls), true);
  assert.equal(homepageInUrls("https://example.com", p.urls), true);
  assert.equal(homepageInUrls("https://example.com/missing", p.urls), false);

  const index = `<sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap></sitemapindex>`;
  const pi = parseSitemap(index);
  assert.equal(pi.isIndex, true);
  assert.deepEqual(pi.childSitemaps, ["https://example.com/post-sitemap.xml"]);

  const bad = parseSitemap("<html><body>not a sitemap</body></html>");
  assert.equal(bad.malformed, true);
  assert.equal(parseSitemap("").malformed, true);
});

test("seo matchSpamCategories: categories only, word boundaries, no snippets", () => {
  assert.deepEqual(matchSpamCategories("Best casino reviews and poker news"), ["gambling"]);
  assert.deepEqual(matchSpamCategories("We sell widgets"), []);
  // "casino" inside another word must not match.
  assert.deepEqual(matchSpamCategories("The casinova band played"), []);
  assert.deepEqual(matchSpamCategories("Payday loan and casino deals"), ["gambling", "loans"]);
  // Returned values are labels, never matched text.
  const matched = matchSpamCategories("viagra cheap");
  assert.deepEqual(matched, ["pharma"]);
  assert.ok(!JSON.stringify(matched).includes("viagra"));
});
