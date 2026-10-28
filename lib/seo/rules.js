// Tool 11 deterministic rules (Milestone 15). Input: parsed homepage /
// robots / sitemap evidence + snapshot SEO-plugin evidence + advisory
// context. Output: bounded findings. Severity/confidence rules (see
// docs/tool11-plan.md §4): observed facts are HIGH confidence; heuristic
// indicators are LOW confidence and labelled as such; anything not
// checked is insufficient evidence, never a pass. No finding ever claims
// a page is indexed/deindexed, spam/hack is confirmed, or a site is
// SEO-clean/spam-free.

export const SEO_PLUGIN_SLUGS = Object.freeze([
  "wordpress-seo",
  "rank-math",
  "all-in-one-seo-pack",
  "seopress",
  "slim-seo",
  "the-seo-framework",
]);

// Snapshot plugin evidence by canonical slug ONLY. v1 snapshots carry
// display names only and therefore yield NOT_CHECKED for every slug —
// a display name NEVER identifies a plugin.
export function seoPluginSummary(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.plugins)) {
    return { status: "NOT_CHECKED", reason: "NO_SNAPSHOT_PLUGIN_LIST", plugins: [] };
  }
  const bySlug = new Map();
  for (const p of snapshot.plugins) {
    if (p && typeof p.slug === "string") bySlug.set(p.slug.toLowerCase(), p);
  }
  const plugins = SEO_PLUGIN_SLUGS.map((slug) => {
    const p = bySlug.get(slug);
    if (!p) return { slug, status: "NOT_INSTALLED", version: null };
    return { slug, status: p.active ? "ACTIVE" : "INSTALLED_INACTIVE", version: p.version ?? null };
  });
  const active = plugins.filter((p) => p.status === "ACTIVE");
  return {
    status: active.length > 0 ? "SEO_PLUGIN_ACTIVE" : "NO_SEO_PLUGIN_ACTIVE",
    plugins,
    activeSlugs: active.map((p) => p.slug),
  };
}

function finding(code, severity, title, explanation, evidence, recommendation, confidence, evidenceStatus, checkId, limitations = null) {
  return { code, severity, title, explanation, evidence: evidence ?? {}, recommendation, confidence, evidenceStatus, checkId, limitations };
}

export function runSeoRules(input) {
  const findings = [];
  const { homepage, head, robots, sitemap, seoPlugin, searchConsoleStatus } = input;
  const headNote = head && !head.headComplete
    ? " The homepage head section was not fully inside the captured 64 KiB prefix, so a tag reported missing here may exist later in the page; treat missing-tag results on this run as low-confidence."
    : " Head evidence comes from the first 64 KiB of the homepage response only.";

  // ---- 1. Indexing signals: homepage fetch + head ----
  if (!homepage || homepage.error) {
    // A blocked redirect chain IS redirect evidence, not a generic
    // fetch failure: report the chain failure, not just "did not run".
    if (homepage?.terminalError === "DOWNGRADE_BLOCKED" || homepage?.terminalError === "TOO_MANY_REDIRECTS") {
      findings.push(finding("REDIRECT_CHAIN_NOTE", "MEDIUM",
        "Homepage redirect chain could not be completed",
        homepage.terminalError === "DOWNGRADE_BLOCKED"
          ? "A redirect from https to http was blocked by the scanner and not followed. An https page must never downgrade to http."
          : "The homepage redirect chain hit the 5-hop limit or looped, so the final page was not reached.",
        { terminalError: homepage.terminalError, redirectCount: homepage.redirectCount },
        "Inspect the site's redirect rules and remove loops or downgrades; a redirect loop also harms search crawling.",
        "HIGH", "OBSERVED", "redirects"));
    } else {
      findings.push(finding("SEO_CHECK_NOT_RUN", "MEDIUM",
        "Homepage check did not run",
        `The homepage could not be fetched (${homepage?.terminalError ?? homepage?.error ?? "UNKNOWN"}), so title, description, robots, and canonical checks have no evidence on this run. This is not a verdict about the site.`,
        { terminalError: homepage?.terminalError ?? homepage?.error ?? null },
        "Re-run the check when the site is reachable, and verify the homepage loads in a browser.",
        "HIGH", "INSUFFICIENT_EVIDENCE", "homepage"));
    }
  } else {
    if (homepage.crossHostRedirect) {
      findings.push(finding("UNEXPECTED_REDIRECT", "MEDIUM",
        "Homepage redirects to a different host",
        `The homepage redirects to a different hostname (${homepage.crossHostDestinationHost ?? "unknown"}). The redirect destination was not fetched for further checks. A cross-host homepage redirect deserves human review: it can be a legitimate domain move, but it can also be a sign of a compromised redirect. This finding alone does not prove anything malicious.`,
        { redirectCount: homepage.redirectCount, crossHostDestinationHost: homepage.crossHostDestinationHost ?? null, finalUrl: homepage.finalUrl },
        "Confirm the redirect destination is intended (domain move, www/non-www consolidation, or hosting change). If it is not intended, investigate the site's redirect settings with a qualified responder before changing anything.",
        "HIGH", "OBSERVED", "redirects"));
    } else if (homepage.redirectCount > 0) {
      findings.push(finding("REDIRECT_CHAIN_NOTE", "LOW",
        "Homepage redirects within the same host",
        `The homepage redirects ${homepage.redirectCount} time(s) within the same host before reaching its final URL. Same-host redirects are common (http→https, non-www→www), but each hop adds latency and a failure point.`,
        { redirectCount: homepage.redirectCount, finalUrl: homepage.finalUrl, finalStatus: homepage.finalStatus },
        "If the redirect is intentional (for example http→https), no action is needed. Review any redirect you do not recognise.",
        "HIGH", "OBSERVED", "redirects"));
    }
    if (homepage.terminalError === "TOO_MANY_REDIRECTS" || homepage.terminalError === "DOWNGRADE_BLOCKED") {
      findings.push(finding("REDIRECT_CHAIN_NOTE", "MEDIUM",
        "Homepage redirect chain could not be completed",
        homepage.terminalError === "DOWNGRADE_BLOCKED"
          ? "A redirect from https to http was blocked by the scanner and not followed. An https page must never downgrade to http."
          : "The homepage redirect chain hit the 5-hop limit or looped, so the final page was not reached.",
        { terminalError: homepage.terminalError, redirectCount: homepage.redirectCount },
        "Inspect the site's redirect rules and remove loops or downgrades; a redirect loop also harms search crawling.",
        "HIGH", "OBSERVED", "redirects"));
    }
    if (head) {
      if (!head.title.present || head.title.empty) {
        findings.push(finding("SEO_TITLE_MISSING", "MEDIUM",
          "Homepage title is missing or empty",
          `No usable <title> was found in the captured homepage head.${headNote}`,
          { headComplete: head.headComplete },
          "Add a descriptive, unique <title> to the homepage (via the theme or an SEO plugin).",
          head.headComplete ? "HIGH" : "LOW", head.headComplete ? "OBSERVED" : "INSUFFICIENT_EVIDENCE", "head"));
      } else if (head.title.length < 30 || head.title.length > 60) {
        findings.push(finding("SEO_TITLE_LENGTH_NOTE", "LOW",
          "Homepage title length is outside the usual band",
          `The homepage title is ${head.title.length} characters. WP Doctor's heuristic band is 30–60 characters; this is NOT a Google rule and a title outside the band is not an error — it is a note to review whether the title reads well in search results.`,
          { titleLength: head.title.length, band: "30-60 (heuristic)" },
          "Review the title for clarity; shorten or expand it only if it reads poorly.",
          "MEDIUM", "OBSERVED", "head"));
      }
      if (!head.description.present || head.description.empty) {
        findings.push(finding("META_DESCRIPTION_MISSING", "LOW",
          "Homepage meta description is missing or empty",
          `No usable meta description was found in the captured homepage head.${headNote} A missing description does not block indexing; search engines may generate their own snippet.`,
          { headComplete: head.headComplete },
          "Add a concise meta description summarising the homepage (via the theme or an SEO plugin).",
          head.headComplete ? "HIGH" : "LOW", head.headComplete ? "OBSERVED" : "INSUFFICIENT_EVIDENCE", "head"));
      } else if (head.description.length < 50 || head.description.length > 160) {
        findings.push(finding("SEO_TITLE_LENGTH_NOTE", "LOW",
          "Homepage meta description length is outside the usual band",
          `The homepage meta description is ${head.description.length} characters. WP Doctor's heuristic band is 50–160 characters; this is NOT a Google rule, only a readability note.`,
          { descriptionLength: head.description.length, band: "50-160 (heuristic)" },
          "Review the description for clarity; adjust only if it reads poorly in search results.",
          "MEDIUM", "OBSERVED", "head"));
      }
      const noindexTokens = head.robotsTokens.filter((t) => t === "noindex" || t === "none");
      if (noindexTokens.length > 0) {
        findings.push(finding("META_ROBOTS_NOINDEX", "HIGH",
          "Homepage carries a noindex signal",
          `The homepage meta robots tag includes "${noindexTokens.join(", ")}" (verbatim value: "${head.robotsTokens.join(", ")}"). This is an indexing SIGNAL telling cooperating crawlers not to index this page — it is not proof the page is deindexed, and it says nothing about other pages. If the homepage should appear in search results, this is the highest-impact signal in this report.`,
          { robotsTokens: head.robotsTokens },
          "If the homepage should be searchable, remove the noindex directive (theme setting, SEO plugin setting, or a staging/privacy setting left enabled). Then verify in Google Search Console. If the page is intentionally private, no action is needed.",
          "HIGH", "OBSERVED", "head"));
      }
      if (!head.canonical.present) {
        findings.push(finding("CANONICAL_MISSING", "LOW",
          "Homepage has no canonical link",
          `No canonical link was found in the captured homepage head.${headNote} A missing canonical does not block indexing, but it leaves the preferred URL ambiguous when the page is reachable under several URLs.`,
          { headComplete: head.headComplete },
          "Add a self-referential canonical link to the homepage (most SEO plugins do this automatically).",
          head.headComplete ? "HIGH" : "LOW", head.headComplete ? "OBSERVED" : "INSUFFICIENT_EVIDENCE", "head"));
      } else if (head.canonical.value) {
        let canonHost = null;
        let pageHost = null;
        try { canonHost = new URL(head.canonical.value, homepage.finalUrl).hostname; } catch { /* unparseable */ }
        try { pageHost = new URL(homepage.finalUrl).hostname; } catch { /* unparseable */ }
        const isSelf = (() => {
          try {
            const c = new URL(head.canonical.value, homepage.finalUrl);
            const f = new URL(homepage.finalUrl);
            const norm = (u) => `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, "") || "/"}`;
            return norm(c) === norm(f);
          } catch { return false; }
        })();
        if (!isSelf) {
          const crossHost = canonHost && pageHost && canonHost !== pageHost;
          findings.push(finding("CANONICAL_MISMATCH", crossHost ? "MEDIUM" : "LOW",
            crossHost ? "Homepage canonical points to a different host" : "Homepage canonical points elsewhere",
            crossHost
              ? `The canonical link points to a different hostname (${canonHost}). A cross-host canonical tells search engines to prefer another site's page; if that is not an intentional consolidation, it can suppress this homepage in search results. Review it promptly.`
              : "The canonical link does not match the final homepage URL. This can be intentional (trailing-slash or parameter normalisation), but an unexpected canonical can suppress the page in search results.",
            { canonicalHost: canonHost, finalHost: pageHost, selfReferential: false },
            "Confirm the canonical URL is the intended preferred URL for the homepage; correct it in the theme or SEO plugin if it is not.",
            "HIGH", "OBSERVED", "head"));
        }
      }
      // X-Robots-Tag header evidence (final homepage response).
      const xRobots = homepage.headers ? (homepage.headers["x-robots-tag"] ?? null) : null;
      if (typeof xRobots === "string") {
        const tokens = xRobots.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
        if (tokens.includes("noindex") || tokens.includes("none")) {
          findings.push(finding("X_ROBOTS_NOINDEX", "HIGH",
            "Homepage carries an X-Robots-Tag noindex signal",
            `The final homepage response includes an X-Robots-Tag header with "${tokens.join(", ")}" (verbatim). Like a meta noindex, this is an indexing SIGNAL, not proof of deindexing. Check whether it is set intentionally (server config, plugin, or hosting rule).`,
            { xRobotsTag: xRobots.slice(0, 200) },
            "If the homepage should be searchable, remove the noindex X-Robots-Tag rule; if the page is intentionally private, no action is needed.",
            "HIGH", "OBSERVED", "headers"));
        }
      }
    }
  }

  // ---- 2. robots.txt ----
  if (!robots) {
    findings.push(finding("SEO_CHECK_NOT_RUN", "LOW", "robots.txt check did not run",
      "The robots.txt check produced no evidence on this run (fetch error or request cap). This is not a verdict about the site.",
      {}, "Re-run the check and verify /robots.txt loads in a browser.", "HIGH", "INSUFFICIENT_EVIDENCE", "robots"));
  } else if (robots.status === 404 || robots.present === false) {
    findings.push(finding("ROBOTS_TXT_MISSING", "LOW",
      "robots.txt is missing (404)",
      "No robots.txt was found at the site root. A missing robots.txt is not an error: crawlers then assume everything may be crawled. It only matters if the site needs crawl rules or a sitemap reference.",
      { status: robots.status ?? 404 },
      "No action is required unless crawl rules or a sitemap reference are wanted; then create a robots.txt with those entries.",
      "HIGH", "OBSERVED", "robots"));
  } else if (robots.error) {
    findings.push(finding("SEO_CHECK_NOT_RUN", "LOW", "robots.txt check did not complete",
      `robots.txt could not be fetched (${robots.error}). No conclusion about crawl rules is possible from this run.`,
      { error: robots.error },
      "Re-run the check and verify /robots.txt loads in a browser.",
      "HIGH", "INSUFFICIENT_EVIDENCE", "robots"));
  } else {
    if (robots.blocksHomepage) {
      findings.push(finding("ROBOTS_BLOCKS_HOMEPAGE", "HIGH",
        "robots.txt disallows the homepage for all crawlers",
        `The \`*\` group in robots.txt contains a Disallow rule that matches the homepage path: "${robots.blockingRule}". Cooperating crawlers will not crawl the homepage while this rule stands. This is a crawl signal, not proof of deindexing — but it is the highest-impact crawl finding in this report.`,
        { blockingRule: robots.blockingRule },
        "If the homepage should be crawled, remove or narrow the Disallow rule in robots.txt (never edit robots.txt through this tool — edit it in WordPress/hosting directly). If the block is intentional, no action is needed.",
        "HIGH", "OBSERVED", "robots"));
    }
    if (robots.malformedLineNumbers && robots.malformedLineNumbers.length > 0) {
      findings.push(finding("SEO_EVIDENCE_INSUFFICIENT", "LOW",
        "robots.txt has unparseable lines",
        `Some robots.txt lines could not be parsed (line numbers: ${robots.malformedLineNumbers.slice(0, 20).join(", ")}). Rules affected by those lines are treated as insufficient evidence, never as verdicts.`,
        { malformedLineNumbers: robots.malformedLineNumbers.slice(0, 20) },
        "Review the flagged lines in robots.txt for typos (a missing colon is the usual cause).",
        "HIGH", "INSUFFICIENT_EVIDENCE", "robots"));
    }
  }

  // ---- 3. Sitemap ----
  if (!sitemap) {
    findings.push(finding("SEO_CHECK_NOT_RUN", "LOW", "Sitemap check did not run",
      "The sitemap check produced no evidence on this run. This is not a verdict about the site.",
      {}, "Re-run the check and verify /sitemap.xml loads in a browser.", "HIGH", "INSUFFICIENT_EVIDENCE", "sitemap"));
  } else if (sitemap.status === "MISSING") {
    findings.push(finding("SITEMAP_MISSING", "LOW",
      "No sitemap was found",
      "Neither robots.txt nor the conventional /sitemap.xml location yielded a sitemap. A missing sitemap does not block indexing, but it removes a discovery aid for crawlers.",
      { checkedSources: sitemap.checkedSources ?? [] },
      "If the site uses an SEO plugin, enable its sitemap feature and confirm the sitemap URL; otherwise no action is required.",
      "HIGH", "OBSERVED", "sitemap"));
  } else if (sitemap.status === "UNREACHABLE") {
    findings.push(finding("SITEMAP_UNREACHABLE", "LOW",
      "Sitemap could not be reached",
      `A sitemap URL was identified but could not be fetched (${sitemap.error ?? "fetch failed"}). No conclusion about sitemap contents is possible from this run.`,
      { error: sitemap.error ?? null },
      "Verify the sitemap URL loads in a browser and that the server returns it without blocking automated requests.",
      "HIGH", "INSUFFICIENT_EVIDENCE", "sitemap"));
  } else if (sitemap.status === "MALFORMED") {
    findings.push(finding("SITEMAP_MALFORMED", "MEDIUM",
      "Sitemap content could not be parsed",
      `A sitemap was fetched but its content was not a recognised sitemap or sitemap index (${sitemap.error ?? "unrecognised content"}). Crawlers may ignore a malformed sitemap.`,
      { error: sitemap.error ?? null },
      "Regenerate the sitemap (SEO plugin or generator) and verify it parses as XML.",
      "MEDIUM", "OBSERVED", "sitemap"));
  } else if (sitemap.status === "OK") {
    if (sitemap.homepagePresent === false) {
      findings.push(finding("HOMEPAGE_NOT_IN_CHECKED_SITEMAPS", "LOW",
        "Homepage not found in the checked sitemaps",
        `The homepage URL was not found among the ${sitemap.entryCount ?? 0} entries in the checked sitemap(s). This means only that: it is NOT a claim that the page is unindexed — search engines discover pages through links as well as sitemaps.`,
        { entryCount: sitemap.entryCount ?? 0, sitemapsChecked: sitemap.sitemapsChecked ?? 0 },
        "If the homepage should be listed, confirm the sitemap generator includes it (some generators exclude the front page by configuration).",
        "MEDIUM", "OBSERVED", "sitemap"));
    }
    if (sitemap.truncated) {
      findings.push(finding("SEO_EVIDENCE_INSUFFICIENT", "LOW",
        "Sitemap entry inspection was capped",
        "Sitemap inspection is capped at 1,000 URLs and 5 child sitemaps; entries beyond the cap were not inspected, so absence claims cover only the checked portion.",
        { entryCount: sitemap.entryCount ?? 0 },
        "For a full sitemap review, inspect the complete sitemap files directly.",
        "HIGH", "INSUFFICIENT_EVIDENCE", "sitemap"));
    }
  }

  // ---- 4. Spam indicators (heuristic only) ----
  if (input.spam) {
    const cats = input.spam.keywordCategories ?? [];
    if (cats.length > 0) {
      findings.push(finding("SPAM_KEYWORD_INDICATOR", cats.length >= 2 ? "MEDIUM" : "LOW",
        "Suspicious-keyword heuristic matched in homepage head text",
        `The homepage title/meta description contains terms in the ${cats.join(", ")} categor${cats.length > 1 ? "ies" : "y"} of a small high-risk keyword list. This is a HEURISTIC indicator for human review, NOT confirmed SEO spam: legitimate sites use these words in normal content (a pharmacy, a news article, a loan provider). Only the category label is stored — no matched text is kept.`,
        { keywordCategories: cats },
        "Read the homepage title and description: if the wording is legitimate site content, dismiss this indicator. If unexpected promotional or off-topic wording appears, investigate the theme, SEO plugin settings, and recent edits with a qualified responder.",
        "LOW", "HEURISTIC_INDICATOR", "spam"));
    }
    if ((input.spam.externalLinkCount ?? 0) >= 20 || (input.spam.hiddenLinkCount ?? 0) >= 1) {
      findings.push(finding("SUSPICIOUS_OUTBOUND_LINK_INDICATOR", "LOW",
        "Unusual outbound-link pattern in the captured homepage prefix",
        `The captured homepage prefix contains ${input.spam.externalLinkCount ?? 0} external link(s) and ${input.spam.hiddenLinkCount ?? 0} hidden-style link(s). A large number of off-topic external links, or links hidden with CSS, is a classic injected-spam pattern — but it is only a HEURISTIC indicator here: menus, footers, and partner links are legitimate, and this check sees only the first 64 KiB. One link is never a verdict.`,
        { externalLinkCount: input.spam.externalLinkCount ?? 0, hiddenLinkCount: input.spam.hiddenLinkCount ?? 0, totalLinkCount: input.spam.totalLinkCount ?? 0 },
        "Inspect the homepage's outbound links in a browser: if unexpected off-topic or hidden links appear, investigate the theme, widgets, and recent edits before changing anything.",
        "LOW", "HEURISTIC_INDICATOR", "spam"));
    }
  }

  // ---- 5. Search Console (always NOT_CONFIGURED unless integrated) ----
  if (searchConsoleStatus === "NOT_CONFIGURED" || !searchConsoleStatus) {
    findings.push(finding("SEARCH_CONSOLE_NOT_CONFIGURED", "LOW",
      "Search Console is not connected",
      "No Search Console integration exists in this tool, so no Search Console data was consulted. Indexing status is UNKNOWN from this tool's evidence alone: nothing here proves a page is indexed or deindexed.",
      { searchConsoleStatus: "NOT_CONFIGURED" },
      "For real indexing status, check the URL in Google Search Console (URL Inspection) and confirm coverage there; treat this report's signals as prompts for that manual check.",
      "HIGH", "OBSERVED", "search-console"));
  }

  // ---- 6. SEO-plugin evidence state ----
  if (seoPlugin && seoPlugin.status === "NOT_CHECKED") {
    findings.push(finding("SEO_EVIDENCE_INSUFFICIENT", "LOW",
      "SEO-plugin evidence not checked on this run",
      seoPlugin.reason === "URL_ONLY"
        ? "This was a URL-only run, so no connector snapshot was available and SEO-plugin presence was not checked. Plugin evidence requires a registered website with a fresh snapshot."
        : "The connector snapshot did not carry a plugin list with canonical slugs, so SEO-plugin presence could not be determined from it. Display names are never used to identify a plugin.",
      { reason: seoPlugin.reason ?? null },
      "Re-run with a registered website (fresh snapshot) for plugin evidence.",
      "HIGH", "INSUFFICIENT_EVIDENCE", "seo-plugin"));
  }
  return findings;
}
