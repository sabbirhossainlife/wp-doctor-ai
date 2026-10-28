// Tool 11 parsers (Milestone 15). Pure functions over bounded, already
// captured text. Nothing here performs network I/O, writes files, or
// executes parsed content: sitemap XML is treated strictly as data, and
// HTML is scanned with bounded regular expressions over the captured
// head prefix only. No parsed content beyond a bounded page title (≤ 300
// chars, page metadata) and category labels is ever persisted.

export const TITLE_LENGTH_NOTE = Object.freeze({ shortBelow: 30, longAbove: 60 });
export const DESCRIPTION_LENGTH_NOTE = Object.freeze({ shortBelow: 50, longAbove: 160 });

function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ""; } });
}

function stripTags(text) {
  return String(text ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) ||
    tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? m[1] : null;
}

// Head section inside the captured prefix: up to </head> or <body>,
// whichever comes first. If neither terminator is present, the whole
// prefix is used but headComplete is false (see parseHead).
export function headSection(prefix) {
  if (typeof prefix !== "string") return { head: "", headComplete: false };
  const lower = prefix.toLowerCase();
  const headEnd = lower.indexOf("</head>");
  const bodyStart = lower.indexOf("<body");
  let end = -1;
  let complete = false;
  if (headEnd !== -1) { end = headEnd; complete = true; }
  else if (bodyStart !== -1) { end = bodyStart; complete = true; }
  return { head: end === -1 ? prefix : prefix.slice(0, end), headComplete: complete };
}

export function parseHead(prefix, { pageHost = null } = {}) {
  const { head, headComplete } = headSection(prefix);
  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleRaw = titleMatch ? stripTags(decodeEntities(titleMatch[1])) : null;
  const title = titleRaw === null ? null : titleRaw.slice(0, 300);

  let description = null;
  let robotsTokens = [];
  let canonical = null;
  let ogTitle = false;
  let ogDescription = false;
  let ogImage = false;
  let hreflangCount = 0;
  const metaTags = head.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const name = (attr(tag, "name") || "").toLowerCase();
    const property = (attr(tag, "property") || "").toLowerCase();
    const content = attr(tag, "content");
    if (name === "description" && description === null && content !== null) description = content.slice(0, 500);
    if (name === "robots" && content !== null) {
      robotsTokens = content.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);
    }
    if (property === "og:title") ogTitle = true;
    if (property === "og:description") ogDescription = true;
    if (property === "og:image") ogImage = true;
  }
  const linkTags = head.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const rel = (attr(tag, "rel") || "").toLowerCase();
    const href = attr(tag, "href");
    if (rel === "canonical" && canonical === null && href) canonical = href.slice(0, 2048);
    if (rel === "alternate" && attr(tag, "hreflang")) hreflangCount += 1;
  }

  // Outbound links: counted from the captured prefix (head + whatever body
  // start the prefix contains). Only counts and host-equality are kept —
  // no link URLs are stored.
  let externalLinkCount = 0;
  let totalLinkCount = 0;
  let hiddenLinkCount = 0;
  const anchorTags = (typeof prefix === "string" ? prefix : "").match(/<a\b[^>]*>/gi) || [];
  for (const tag of anchorTags) {
    const href = attr(tag, "href");
    if (!href) continue;
    totalLinkCount += 1;
    const style = (attr(tag, "style") || "").toLowerCase();
    const hidden = /display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style);
    let isExternal = false;
    if (/^https?:\/\//i.test(href)) {
      try {
        const host = new URL(href).hostname;
        isExternal = pageHost ? host !== pageHost : true;
      } catch { isExternal = false; }
    }
    if (isExternal) externalLinkCount += 1;
    if (hidden && isExternal) hiddenLinkCount += 1;
    else if (hidden) hiddenLinkCount += 1;
  }

  return {
    headComplete,
    title: { present: titleMatch !== null, value: title, length: title ? [...title].length : 0, empty: titleMatch !== null && (!title || title.length === 0) },
    description: { present: description !== null, value: description, length: description ? [...description].length : 0, empty: description !== null && description.length === 0 },
    robotsTokens,
    canonical: { present: canonical !== null, value: canonical },
    og: { title: ogTitle, description: ogDescription, image: ogImage },
    hreflangCount,
    externalLinkCount,
    totalLinkCount,
    hiddenLinkCount,
  };
}

function robotsPatternToRegex(pattern) {
  // Conservative robots.txt matching: `*` → `.*`, trailing `$` anchors.
  // Prefix match otherwise (robots.txt semantics: longest match wins;
  // this checker only needs the homepage path `/`, where a Disallow of
  // `/` blocks and an empty Disallow allows).
  let regex = "^";
  for (const ch of pattern) {
    if (ch === "*") regex += ".*";
    else if (ch === "$") regex += "$";
    else regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(regex);
}

function pathBlockedByRules(rules, path) {
  // rules: [{ pattern }] in file order. Longest matching pattern wins;
  // ties: the first (Allow wins ties per RFC 9309 — we only track
  // Disallow here, so a tie with an Allow is handled by the caller
  // passing allows too). Returns the winning rule or null.
  let best = null;
  for (const rule of rules) {
    if (!rule.pattern) continue; // empty Disallow = allow everything
    let matches = false;
    try { matches = robotsPatternToRegex(rule.pattern).test(path); } catch { matches = path.startsWith(rule.pattern); }
    if (matches && (!best || rule.pattern.length > best.pattern.length)) best = rule;
  }
  return best;
}

export function parseRobots(text, { siteHost = null, homepagePath = "/" } = {}) {
  if (typeof text !== "string") {
    return { present: false, status: null, sitemapUrls: [], crossHostSitemapCount: 0, disallowsStar: [], blocksHomepage: false, blockingRule: null, malformedLineNumbers: [], googlebotGroupPresent: false };
  }
  const sitemapUrls = [];
  let crossHostSitemapCount = 0;
  const disallowsStar = [];
  const malformedLineNumbers = [];
  let googlebotGroupPresent = false;
  // Group tracking (RFC 9309 shape): consecutive User-agent lines open a
  // group; the first rule line closes it for agent purposes, so the next
  // User-agent line starts a new group. Sitemap lines are group-independent
  // and are collected regardless of the current group.
  let currentAgents = [];
  let groupOpenForAgents = false;
  const lines = text.split(/\r?\n/).slice(0, 5000);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const hash = line.indexOf("#");
    if (hash !== -1) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) { if (malformedLineNumbers.length < 20) malformedLineNumbers.push(i + 1); continue; }
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!groupOpenForAgents) currentAgents = [];
      groupOpenForAgents = true;
      currentAgents.push(value.toLowerCase());
      if (currentAgents.includes("googlebot")) googlebotGroupPresent = true;
    } else if (field === "disallow") {
      groupOpenForAgents = false;
      if (currentAgents.includes("*")) disallowsStar.push(value.slice(0, 200));
    } else if (field === "allow") {
      // Collected (prefixed) so a longer Allow can win the blocking
      // decision per RFC 9309 longest-match semantics.
      groupOpenForAgents = false;
      if (currentAgents.includes("*")) disallowsStar.push(`ALLOW:${value.slice(0, 200)}`);
    } else if (field === "sitemap") {
      const raw = value.slice(0, 2048);
      try {
        const parsed = new URL(raw, `https://${siteHost ?? "invalid"}/`);
        if (siteHost && parsed.hostname === siteHost) {
          if (sitemapUrls.length < 20) sitemapUrls.push(`${parsed.protocol}//${parsed.host}${parsed.pathname}`);
        } else if (siteHost) crossHostSitemapCount += 1;
        else if (sitemapUrls.length < 20) sitemapUrls.push(raw);
      } catch { /* unparseable sitemap line: ignored, counted via malformed only if no colon (handled above) */ }
    }
    else {
      // Any other rule field (Crawl-delay, Host, etc.) closes the agent
      // group; Sitemap lines above deliberately do not.
      groupOpenForAgents = false;
    }
  }
  // Blocking decision for the homepage path (RFC 9309 longest-match:
  // the longest matching rule wins; on a tie, Allow wins).
  const disallowRules = disallowsStar.filter((r) => !r.startsWith("ALLOW:")).map((pattern) => ({ pattern }));
  const allowRules = disallowsStar.filter((r) => r.startsWith("ALLOW:")).map((r) => ({ pattern: r.slice("ALLOW:".length) }));
  const blockedBy = pathBlockedByRules(disallowRules, homepagePath);
  let blocksHomepage = false;
  let blockingRule = null;
  if (blockedBy) {
    const allowWinner = pathBlockedByRules(allowRules, homepagePath);
    if (!allowWinner || allowWinner.pattern.length < blockedBy.pattern.length) {
      blocksHomepage = true;
      blockingRule = blockedBy.pattern;
    }
  }
  return {
    present: true,
    status: null,
    sitemapUrls,
    crossHostSitemapCount,
    disallowsStar: disallowsStar.filter((r) => !r.startsWith("ALLOW:")),
    blocksHomepage,
    blockingRule,
    malformedLineNumbers,
    googlebotGroupPresent,
  };
}

const MAX_SITEMAP_ENTRIES = 1000;

// Strict-as-data sitemap parsing: recognises <urlset> / <sitemapindex>
// roots only; extracts <loc> contents. Anything else is MALFORMED.
// Returns counts, never the URL list itself beyond a bounded homepage
// presence check done by the caller via `urls` (capped, discarded after
// the check by the engine — the service stores only counts).
export function parseSitemap(xml) {
  if (typeof xml !== "string" || xml.length === 0) {
    return { malformed: true, error: "EMPTY_BODY", isIndex: false, urls: [], childSitemaps: [], entryCount: 0, hasLastmod: false, truncated: false };
  }
  const lower = xml.toLowerCase();
  const isIndex = lower.includes("<sitemapindex");
  const isUrlset = lower.includes("<urlset");
  if (!isIndex && !isUrlset) {
    return { malformed: true, error: "UNRECOGNISED_ROOT", isIndex: false, urls: [], childSitemaps: [], entryCount: 0, hasLastmod: false, truncated: false };
  }
  const locs = [];
  const locRe = /<loc>([\s\S]*?)<\/loc>/gi;
  let m;
  while ((m = locRe.exec(xml)) !== null) {
    const value = decodeEntities(m[1]).trim().slice(0, 2048);
    if (value) locs.push(value);
    if (locs.length >= MAX_SITEMAP_ENTRIES) break;
  }
  const truncated = locs.length >= MAX_SITEMAP_ENTRIES;
  return {
    malformed: false,
    error: null,
    isIndex,
    urls: isIndex ? [] : locs,
    childSitemaps: isIndex ? locs : [],
    entryCount: locs.length,
    hasLastmod: /<lastmod>/i.test(xml),
    truncated,
  };
}

// Homepage presence in checked sitemaps: compares origin + path, ignoring
// trailing-slash differences and query/fragment. Never a claim about
// search-engine indexing — only about the checked files.
export function homepageInUrls(homepageUrl, urls) {
  let target;
  try {
    const t = new URL(homepageUrl);
    target = `${t.protocol}//${t.host}${t.pathname.replace(/\/$/, "") || "/"}`;
  } catch { return false; }
  for (const raw of urls || []) {
    try {
      const u = new URL(raw);
      const norm = `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, "") || "/"}`;
      if (norm === target) return true;
    } catch { /* skip unparseable entry */ }
  }
  return false;
}

// Spam keyword categories (head text only). Returns matched category
// labels ONLY — never the matched snippet, never surrounding text.
export const SPAM_CATEGORIES = Object.freeze({
  gambling: ["casino", "poker", "slots", "sportsbook", "betting"],
  pharma: ["viagra", "cialis", "levitra", "tramadol", "oxycodone"],
  adult: ["porn", "xxx", "sex chat"],
  loans: ["payday loan", "quick loan", "instant loan", "cash advance"],
});

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchSpamCategories(text) {
  const haystack = ` ${String(text ?? "").toLowerCase()} `;
  const matched = [];
  for (const [category, terms] of Object.entries(SPAM_CATEGORIES)) {
    for (const term of terms) {
      const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`, "i");
      if (pattern.test(haystack)) { matched.push(category); break; }
    }
  }
  return matched;
}
