// Tool 11 orchestration (Milestone 15). Synchronous bounded flow:
// homepage probe (head capture) -> robots.txt -> sitemaps (index +
// ≤ 5 children) -> parse -> spam categories -> deterministic rules.
// Diagnostic-only: no POST, no mutation, no crawling of listed pages,
// no fetching of sitemap URLs as pages. The parsed head prefix and all
// fetched bodies are discarded after parsing; only bounded summaries
// (counts, statuses, a ≤ 300-char title, category labels) are returned.
// deps (all injectable for tests):
//   probe — fn like probeUrl (default: probeUrl). Tests inject a fake.
//   testPin — TEST-ONLY pin seam forwarded to the real probeUrl; the
//     service and routes NEVER pass it.
//   nowMs — unused clock hook kept for symmetry with other engines.
import { probeUrl, probeHomepage, probeRobots, probeSitemap, SEO_HTTP_LIMITS } from "./http.js";
import { parseHead, parseRobots, parseSitemap, homepageInUrls, matchSpamCategories } from "./parse.js";
import { runSeoRules, seoPluginSummary } from "./rules.js";
import { redactUrlForLog } from "../scanner/errors.js";

function bestEffortRedact(input) {
  try { return redactUrlForLog(new URL(input).toString()); } catch { return "[invalid-url]"; }
}

function originOf(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}

export async function runSeoCheck(input, deps = {}) {
  const started = Date.now();
  const rawInput = typeof input === "string" ? input.trim() : "";
  const sanitizedTargetUrl = bestEffortRedact(rawInput);
  const count = { n: 0 };
  const realProbe = deps.probe ?? ((url, opts) => probeUrl(url, { ...opts, ...(deps.testPin ? { testPin: deps.testPin } : {}) }));
  const probe = (url, opts) => realProbe(url, opts);

  // 1. Homepage (+ head capture). A cross-host redirect stops the
  // homepage check but robots/sitemap still run against the REQUESTED
  // origin — they describe the requested site, not the redirect target.
  const homepage = await probeHomepage(rawInput, { probe, count });
  const homepageOk = !homepage.error && !homepage.crossHostRedirect && homepage.headPreview !== null;
  let head = null;
  if (homepage.headPreview !== null) {
    const pageHost = (() => { try { return new URL(homepage.finalUrl).hostname; } catch { return null; } })();
    head = parseHead(homepage.headPreview, { pageHost });
  }
  const homepageSummary = {
    requestedUrl: sanitizedTargetUrl,
    finalUrl: homepage.finalUrl,
    finalStatus: homepage.finalStatus,
    redirectCount: homepage.redirectCount,
    crossHostRedirect: homepage.crossHostRedirect,
    crossHostDestinationHost: homepage.crossHostDestinationHost,
    terminalError: homepage.terminalError,
    chain: homepage.chain,
    xRobotsTag: homepage.headers ? (homepage.headers["x-robots-tag"] ?? null) : null,
    contentType: homepage.headers ? (homepage.headers["content-type"] ?? null) : null,
    headCapturedBytes: homepage.headPreview !== null ? Buffer.byteLength(homepage.headPreview, "utf8") : 0,
    headComplete: head ? head.headComplete : false,
    headTruncated: homepage.headTruncated,
    title: head ? head.title : null,
    descriptionPresent: head ? head.description.present : null,
    robotsTokens: head ? head.robotsTokens : [],
    canonicalPresent: head ? head.canonical.present : null,
    og: head ? head.og : null,
    hreflangCount: head ? head.hreflangCount : null,
  };

  // 2. robots.txt (requested origin only).
  const robotsRaw = await probeRobots(rawInput, { probe, count });
  let robotsSummary;
  if (robotsRaw.error) {
    robotsSummary = { present: false, status: null, error: robotsRaw.error, sitemapUrls: [], crossHostSitemapCount: 0, blocksHomepage: false, blockingRule: null, malformedLineNumbers: [], googlebotGroupPresent: false };
  } else if (robotsRaw.status === 404) {
    robotsSummary = { present: false, status: 404, error: null, sitemapUrls: [], crossHostSitemapCount: 0, blocksHomepage: false, blockingRule: null, malformedLineNumbers: [], googlebotGroupPresent: false };
  } else if (robotsRaw.status !== 200 || typeof robotsRaw.body !== "string") {
    robotsSummary = { present: false, status: robotsRaw.status, error: `HTTP_${robotsRaw.status}`, sitemapUrls: [], crossHostSitemapCount: 0, blocksHomepage: false, blockingRule: null, malformedLineNumbers: [], googlebotGroupPresent: false };
  } else {
    const siteHost = (() => { try { return new URL(rawInput).hostname; } catch { return null; } })();
    const parsed = parseRobots(robotsRaw.body, { siteHost });
    robotsSummary = { ...parsed, status: 200, error: null };
  }

  // 3. Sitemaps: robots.txt Sitemap lines + conventional /sitemap.xml.
  // Index + ≤ 5 same-host children; ≤ 1,000 entries counted, none stored.
  const origin = originOf(rawInput);
  const candidates = [];
  for (const u of robotsSummary.sitemapUrls ?? []) {
    if (!candidates.includes(u)) candidates.push(u);
  }
  if (origin && !candidates.includes(`${origin}/sitemap.xml`)) candidates.push(`${origin}/sitemap.xml`);
  let sitemapSummary = { status: "MISSING", checkedSources: [], sitemapsChecked: 0, entryCount: 0, homepagePresent: null, hasLastmod: false, truncated: false, error: null };
  if (candidates.length > 0) {
    const checkedUrls = [];
    let homepagePresent = false;
    let entryCount = 0;
    let hasLastmod = false;
    let truncated = false;
    let sawOk = false;
    let sawMalformed = false;
    let lastError = null;
    // First pass: fetch candidates until one parses as a sitemap/index.
    // (Robots-listed sitemaps first, conventional location last.)
    const queue = [...candidates];
    let sitemapsChecked = 0;
    while (queue.length > 0 && sitemapsChecked < 1 + SEO_HTTP_LIMITS.sitemapChildMax) {
      const url = queue.shift();
      if (checkedUrls.includes(url)) continue;
      checkedUrls.push(url);
      const fetched = await probeSitemap(url, { probe, count });
      sitemapsChecked += 1;
      if (fetched.error) { lastError = fetched.error; continue; }
      if (fetched.status === 404) continue;
      if (fetched.status !== 200 || typeof fetched.body !== "string") { lastError = `HTTP_${fetched.status}`; continue; }
      const parsed = parseSitemap(fetched.body);
      if (parsed.malformed) { sawMalformed = true; lastError = parsed.error; continue; }
      sawOk = true;
      if (parsed.isIndex) {
        hasLastmod = hasLastmod || parsed.hasLastmod;
        // Enqueue same-host children (bounded by the overall cap).
        const childHost = (() => { try { return new URL(url).hostname; } catch { return null; } })();
        for (const child of parsed.childSitemaps) {
          try {
            const cu = new URL(child);
            if (cu.hostname === childHost && !checkedUrls.includes(cu.toString()) && !queue.includes(cu.toString())) queue.push(`${cu.protocol}//${cu.host}${cu.pathname}`);
          } catch { /* skip unparseable child */ }
        }
      } else {
        entryCount += parsed.entryCount;
        hasLastmod = hasLastmod || parsed.hasLastmod;
        truncated = truncated || parsed.truncated;
        if (homepageInUrls(homepage.finalUrl || rawInput, parsed.urls)) homepagePresent = true;
      }
      if (fetched.bodyTruncated) truncated = true;
    }
    if (sawOk) {
      sitemapSummary = {
        status: "OK",
        checkedSources: checkedUrls.slice(0, 20),
        sitemapsChecked,
        entryCount,
        homepagePresent,
        hasLastmod,
        truncated,
        error: null,
      };
    } else if (sawMalformed) {
      sitemapSummary = { status: "MALFORMED", checkedSources: checkedUrls.slice(0, 20), sitemapsChecked, entryCount: 0, homepagePresent: null, hasLastmod: false, truncated: false, error: lastError };
    } else if ((robotsSummary.sitemapUrls ?? []).length > 0) {
      // A robots.txt-listed sitemap that cannot be fetched is unreachable,
      // not merely missing.
      sitemapSummary = { status: "UNREACHABLE", checkedSources: checkedUrls.slice(0, 20), sitemapsChecked, entryCount: 0, homepagePresent: null, hasLastmod: false, truncated: false, error: lastError };
    } else {
      sitemapSummary = { status: "MISSING", checkedSources: checkedUrls.slice(0, 20), sitemapsChecked, entryCount: 0, homepagePresent: null, hasLastmod: false, truncated: false, error: null };
    }
    if (candidates.length > 0 && checkedUrls.length === 0) {
      sitemapSummary = { status: "MISSING", checkedSources: [], sitemapsChecked: 0, entryCount: 0, homepagePresent: null, hasLastmod: false, truncated: false, error: null };
    }
  }
  // A homepage that never loaded still gets a sitemap presence verdict
  // only against the REQUESTED url (not a redirect target we never saw).
  if (sitemapSummary.status === "OK" && !homepageOk && sitemapSummary.homepagePresent === false) {
    // Keep as-is: presence was checked against the requested URL via
    // finalUrl fallback in the loop (finalUrl = last chain URL). The
    // limitation below states the check's scope.
  }

  // 4. Spam signals (head text + prefix link counts only).
  const headText = head ? `${head.title.value ?? ""} ${head.description.value ?? ""}` : "";
  const spamSignals = {
    keywordCategories: head ? matchSpamCategories(headText) : [],
    externalLinkCount: head ? head.externalLinkCount : 0,
    totalLinkCount: head ? head.totalLinkCount : 0,
    hiddenLinkCount: head ? head.hiddenLinkCount : 0,
    headTextSource: "title+meta-description only",
  };

  // 5. Snapshot SEO-plugin evidence (websiteId path only; the service
  // passes snapshot, the URL-only path passes null).
  const seoPlugin = deps.snapshot ? seoPluginSummary(deps.snapshot)
    : { status: "NOT_CHECKED", reason: "URL_ONLY", plugins: [] };

  const findings = runSeoRules({
    homepage: {
      ...homepage,
      headers: homepage.headers ?? {},
    },
    head,
    robots: robotsSummary,
    sitemap: sitemapSummary,
    seoPlugin,
    searchConsoleStatus: "NOT_CONFIGURED",
    spam: spamSignals,
  });

  let executionStatus;
  if (homepage.error || homepage.crossHostRedirect) executionStatus = homepage.error && !homepage.chain.length && !homepage.crossHostRedirect ? "FAILED" : "PARTIAL";
  else if (robotsSummary.error || sitemapSummary.status === "UNREACHABLE" || sitemapSummary.status === "MALFORMED") executionStatus = "PARTIAL";
  else executionStatus = "COMPLETED";
  if (homepage.error && homepage.chain.length === 0 && !homepage.crossHostRedirect) executionStatus = "FAILED";

  const limitations = [
    "Head evidence comes from the first 64 KiB of the homepage response only; a tag absent from that prefix is never claimed absent from the page without a low-confidence caveat.",
    "No finding here proves a page is indexed or deindexed: noindex, robots.txt, and sitemap evidence are crawl/indexing SIGNALS, and no Search Console data was consulted (Search Console is not connected).",
    "Spam indicators are heuristics for human review only. A single generic signal never proves SEO spam or a compromise, and no indicator match never proves a site is spam-free.",
    "Sitemap inspection is capped at 1,000 URLs and 5 child sitemaps; listed pages are never fetched (no crawling).",
    "robots.txt parsing considers only the `*` group plus an explicit googlebot group if present; other agent groups are not evaluated.",
    "This tool is diagnostic only: it never modifies robots.txt, metadata, redirects, settings, or site content.",
  ];
  if (sitemapSummary.status === "OK" && !homepageOk) {
    limitations.push("The homepage did not load on this run, so sitemap homepage-presence was checked against the requested URL, not a fetched final URL.");
  }

  return {
    sanitizedTargetUrl,
    requestedTarget: sanitizedTargetUrl,
    finalUrl: homepage.finalUrl,
    executionStatus,
    homepageSummary,
    robotsSummary,
    sitemapSummary,
    spamSignals,
    seoPluginSummary: seoPlugin,
    advisoryContext: deps.advisoryContext ?? null,
    searchConsoleStatus: "NOT_CONFIGURED",
    summary: {
      finalUrl: homepage.finalUrl,
      finalStatus: homepage.finalStatus,
      redirectCount: homepage.redirectCount,
      crossHostRedirect: homepage.crossHostRedirect,
      findingCodes: findings.map((f) => f.code),
      robotsPresent: robotsSummary.present,
      robotsBlocksHomepage: robotsSummary.blocksHomepage,
      sitemapStatus: sitemapSummary.status,
      sitemapEntryCount: sitemapSummary.entryCount,
      homepageInCheckedSitemaps: sitemapSummary.homepagePresent,
      spamKeywordCategories: spamSignals.keywordCategories,
      requestsMade: count.n,
    },
    limitations,
    durationMs: Date.now() - started,
    findings,
  };
}
