# Tool 11 — SEO Spam & Indexing Checker: Plan (Milestone 15)

Status: plan written BEFORE implementation (per brief). Connector unchanged
(1.7.0, snapshot schema v7). Milestone 14 stays PARTIAL; its blocked
restore/migration execution is untouched by this milestone.

## 1. Scope decision (precedents)

Tools 05/06 allow authenticated URL-only passive HTTP checks; Tools
02–04/07/08/09 require an owned registered website + fresh (24 h)
snapshot. Tool 11 supports BOTH paths, following the Tool 06 service
shape (websiteId wins; a client-supplied url alongside websiteId is
ignored):

- (a) websiteId path: server loads the canonical URL + latest snapshot
  from the DB (ownership in WHERE). Snapshot freshness 24 h, same
  statuses as Tools 02–04/06/07/08/09 (MISSING / INVALID / UNSUPPORTED /
  STALE → 422 + re-sync instructions, NO row persisted). Plugin/SEO-plugin
  evidence comes from the snapshot only, identified by canonical slug
  ONLY (see §6). Advisory context (latest Tool 08/09 summary counts) is
  read for the same website only.
- (b) URL-only path: passive HTTP checks only (homepage, robots.txt,
  sitemap). SEO-plugin evidence is NOT_CHECKED, never invented; the
  report says so explicitly. No client-supplied inventory, versions,
  findings, or SEO status is ever accepted as evidence.
- Never: an unauthenticated endpoint; an arbitrary-URL comprehensive
  scan beyond the bounded passive checks in §3; client inventory as
  authoritative evidence.

## 2. HTML-capture design decision (option (a), minimal transport extension)

The M2 scanner discards bodies, and the M12 transport already has an
opt-in bounded first-bytes capture (`captureBodyBytes`, default off).
Tool 11 needs the homepage `<head>`, which is at the START of the body,
so a first-N-bytes prefix is sufficient — but a normal homepage is often
larger than the M2 256 KiB body cap, and the transport currently aborts
oversized bodies with RESPONSE_LIMIT_EXCEEDED even when only a prefix
was requested. Decision:

- Add ONE opt-in transport field, `stopAfterCaptureBytes` (default 0 =
  off, M2 behaviour byte-for-byte unchanged): once the captured prefix
  reaches the cap, the transport stops consuming, destroys the stream,
  and resolves successfully with `bodyTruncated: true`. All M2
  regression tests must still pass, and no other caller passes the flag.
- Tool 11 homepage probe: `captureBodyBytes = stopAfterCaptureBytes =
  64 KiB`, `maxBytes = 256 KiB` (never reached once the stop fires).
  Every report states the 64 KiB prefix limit. Parsing uses only the
  head section inside the prefix (up to `</head>` or `<body>`, whichever
  comes first); if neither terminator is inside the prefix,
  `headComplete: false` and missing-tag findings carry LOW confidence
  plus a prefix limitation — a tag absent from the prefix is NEVER
  reported as absent from the page without that caveat.
- robots.txt: capture 64 KiB, maxBytes 64 KiB. Sitemaps: capture
  256 KiB, maxBytes 256 KiB; oversize → sitemap check PARTIAL with an
  oversize limitation, never a verdict.
- No body content is persisted: the prefix is parsed in-memory and
  discarded. Stored evidence is bounded summaries + counts + at most a
  300-char page title (page metadata, not source code).

## 3. Check catalogue (all through M2 pinned components; no second stack)

Per-diagnostic request cap: 15 (homepage ≤ 6 hops + robots.txt 1 +
sitemap index 1 + ≤ 5 child sitemaps). Every hop re-validated
(parseScanTarget → resolveAndValidate → pinnedRequest). No POST, no
cookies, no credentials, no form submits, no crawling of listed pages.

1. Homepage fetch: status, manual redirect chain (max 5, downgrade
   blocked — Tool 06 behaviour, no TLS conclusions duplicated), final
   URL (redacted: protocol + host + path, no query/fragment),
   X-Robots-Tag / Content-Type / cache headers as evidence only.
2. Homepage head analysis (prefix only, §2): `<title>` (present /
   missing / empty; length bands are WP Doctor heuristics, NOT Google
   rules), meta description (present / missing / empty; heuristic
   bands), meta robots (verbatim tokens, never reinterpreted),
   canonical link (present / missing / self-referential / elsewhere /
   cross-host), Open Graph presence only (og:title / og:description /
   og:image — never a social-preview correctness claim), hreflang link
   presence only (never a correctness claim). noindex is an indexing
   SIGNAL with stated impact, never a deindexing verdict.
3. robots.txt (`/robots.txt` on the requested origin, same-host only):
   only the `*` group + an explicit `googlebot` group if present
   (documented simplification). Missing (404) → ROBOTS_TXT_MISSING
   (info, not an error). Sitemap lines: count + bounded list (≤ 20,
   same-host only; cross-host count only). Homepage path (`/`)
   disallowed for `*` → exact rule quoted (bounded). Malformed lines →
   insufficient evidence for affected rules (line numbers only, never
   a verdict).
4. Sitemap: Sitemap lines from robots.txt AND conventional
   `/sitemap.xml`; sitemap index + ≤ 5 child sitemaps; ≤ 1,000 URLs
   counted, none stored. XML parsed strictly as data (regex extraction
   of `<loc>`/`<lastmod>` from a recognised `<urlset>`/`<sitemapindex>`
   root — no XML library, nothing executed). Missing/unreachable →
   SITEMAP_MISSING / SITEMAP_UNREACHABLE (info + limitation); malformed
   → SITEMAP_MALFORMED (bounded error description); homepage absent →
   "not found in checked sitemaps", NEVER "not indexed". lastmod
   presence only, never a freshness verdict.
5. Redirects: no redirect (OK); same-host chain (hop count + final
   URL); cross-host redirect → UNEXPECTED_REDIRECT (review flag, never
   "malicious" without further evidence) and that check STOPS — the
   cross-host destination is never fetched for further checks. Loop /
   too many / downgrade-blocked from M2 errors → reported as observed
   failures (REDIRECT_CHAIN_NOTE).
6. SEO spam indicators (HEURISTIC ONLY, §5).
7. Search Console: NOT_CONFIGURED — no GSC API integration exists in
   this codebase (verified by grep: only PageSpeed/CrUX googleapis
   references exist, nothing for Search Console). The report states no
   Search Console data was consulted, indexing status is UNKNOWN from
   this tool's evidence, and manual Search Console verification steps
   are recommended. No GSC data is ever invented.
8. SEO plugin / structured evidence (websiteId path only, §6).

## 4. Finding codes (only codes supported by real checks)

SEO_TITLE_MISSING, SEO_TITLE_LENGTH_NOTE, META_DESCRIPTION_MISSING,
META_ROBOTS_NOINDEX, X_ROBOTS_NOINDEX, CANONICAL_MISSING,
CANONICAL_MISMATCH, ROBOTS_TXT_MISSING, ROBOTS_BLOCKS_HOMEPAGE,
SITEMAP_MISSING, SITEMAP_UNREACHABLE, SITEMAP_MALFORMED,
HOMEPAGE_NOT_IN_CHECKED_SITEMAPS, UNEXPECTED_REDIRECT,
REDIRECT_CHAIN_NOTE, SPAM_KEYWORD_INDICATOR,
SUSPICIOUS_OUTBOUND_LINK_INDICATOR, SEARCH_CONSOLE_NOT_CONFIGURED,
SEO_EVIDENCE_INSUFFICIENT, SEO_CHECK_NOT_RUN.
NOT implemented: SEO_SNAPSHOT_STALE — stale runs persist NO row
(422, mirroring Tools 02–04), so the code can never appear on a stored
report; it is deliberately absent rather than silently unused.

Severity/confidence rules: observed facts are stated as facts (HIGH
confidence); heuristic indicators are labelled heuristic with LOW
confidence; anything not checked is insufficient evidence, never a
pass. noindex on the homepage and robots-blocking-homepage are HIGH
severity impact signals, not vulnerabilities. Missing title = MEDIUM,
missing description = LOW, missing robots/sitemap = LOW (info-level).
Spam indicators = LOW (one signal) / MEDIUM (multiple independent
signals) priority for human review, never a confirmed-compromise claim.
A scan with no findings NEVER yields an "SEO clean / fully indexed /
spam-free" badge or claim — the UI and reports carry that limitation
explicitly.

## 5. Spam-indicator set + false-positive safeguards

- (a) Keyword signals in bounded head text (title + meta description)
  ONLY. Categories (matched category label stored, never the snippet):
  gambling {casino, poker, slots, sportsbook, betting},
  pharma {viagra, cialis, levitra, tramadol, oxycodone},
  adult {porn, xxx, sex chat},
  loans {payday loan, quick loan, instant loan, cash advance}.
  Word-boundary matching; one category → LOW, ≥ 2 categories → MEDIUM.
  Documented false-positive path: legitimate sites (e.g. a pharmacy, a
  news article, a loan provider) use these words normally — a match is
  a review prompt, not a verdict.
- (b) Outbound-link signals from the captured prefix ONLY: ≥ 20
  external links, or ≥ 1 link with a hidden style
  (`display:none` / `visibility:hidden`) → LOW indicator. One link is
  never a verdict.
- (c) Cross-host homepage redirect (§3.5) as a spam-review trigger.
- (d) Tool 08/09 advisory context (latest matched-advisory / suspicious
  -file counts for the same website) is shown as context ONLY: a
  vulnerability match never proves malware, and a clean Tool 09 never
  proves a clean site.
- A single generic signal NEVER creates a confirmed-spam finding.
  Multiple independent indicators raise review priority only.

## 6. SEO-plugin evidence (snapshot, canonical slugs only)

Slugs: wordpress-seo (Yoast), rank-math, all-in-one-seo-pack, seopress,
slim-seo, the-seo-framework. Status per slug: ACTIVE / INSTALLED_INACTIVE
/ NOT_INSTALLED / NOT_CHECKED (URL-only path, or snapshot schema v1
which carries display names only — names NEVER identify a plugin).
Sitemap-feature availability is claimed ONLY where fetched robots/sitemap
evidence supports it, never assumed from plugin presence. WordPress/PHP
versions from the snapshot are compatibility context only.

## 7. DB (migration sorts after 20261028030000; dev + test only)

- SeoDiagnostic: id, userId FK cascade, websiteId FK SetNull nullable
  (URL-only runs), sanitizedWebsiteUrl, requestedTarget,
  finalUrl, executionStatus, snapshotSchemaVersion,
  snapshotReceivedAt, snapshotFreshness, homepageSummary Json,
  robotsSummary Json, sitemapSummary Json, spamSignals Json (bounded
  categories only), seoPluginSummary Json, advisoryContext Json,
  searchConsoleStatus, summary Json, limitations Json, startedAt,
  completedAt, createdAt, updatedAt. Findings: SeoDiagnosticFinding
  (Tool 02–10 shape + evidenceCategory, confidence, checkId).
  AI: SeoAiAnalysis 1:1, regeneration overwrites (new model, mirroring
  M6–M13 — no reuse that breaks them).
- Never stored: full HTML bodies, matched code snippets, secrets,
  credentials, absolute paths, query strings, fragments, internal IPs.
  Historical reports immutable; bounded pagination (≤ 100/page).

## 8. API routes (mirror Tools 02–10)

POST /api/seo-diagnostics (auth; websiteId and/or url; ≤ 10 KiB body;
server snapshot + freshness + schema validation; bounded fetches;
client inventory/findings/seo-status ignored; safe error shapes).
GET /api/seo-diagnostics (own only, desc, bounded paging).
GET /api/seo-diagnostics/[id] (ownership in WHERE, identical 404).
POST/GET /api/seo-diagnostics/[id]/ai-analysis (explicit trigger only;
M4 adapter + seo-1 validation; input = sanitized bounded
findings/metadata ONLY — never HTML bodies/snippets/credentials/
secrets/absolute paths; AI never changes deterministic observations;
503 AI_NOT_CONFIGURED when unconfigured; no mock AI in production).
No unauthenticated endpoints. No second auth or AI architecture.

## 9. UI (mirror Tools 02–10; Tailwind; shared components)

`/tools/seo-spam-checker` (+ history/detail, header link): title +
concise explanation, registered-website selector + URL input,
snapshot freshness/state where applicable, Run SEO Check action, real
loading state without fake percentages, input validation + useful
errors, summary of completed/partial/unavailable checks, sections:
(1) Indexing signals, (2) robots.txt, (3) Sitemap, (4) Redirects,
(5) Spam indicators for review, (6) Search Console status,
(7) Not checked / insufficient evidence, (8) Manual next steps.
Evidence + confidence labels on every finding; false-positive warnings
on heuristic indicators; history link; AI section when configured.
Accessible, keyboard-navigable, responsive. NO destructive action
anywhere (no cleanup/edit/delete buttons for site content).

## 10. Tests (execute; label honestly)

- A. Head/robots/sitemap parsing (fixtures).
- B. Redirect + SSRF safety (controlled servers; pinned transport with
  a test-only pin seam — routes never pass it).
- C. Spam indicators (synthetic fixtures, safe patterns only).
- D. Snapshot + website scoping.
- E. API/DB (real test DB via scripts/run-db-tests.mjs).
- F. No-side-effect safety: explicit tests/static assertions — no
  robots.txt/metadata/redirect/settings modification, no content
  deletion, no file writes to target, no form submits, no source HTML
  sent to AI or external services beyond bounded sanitized summaries.
  (By construction: lib/seo contains no POST/PUT/DELETE/PATCH, no fs
  writes to a target, and no fetch outside the pinned transport — the
  test greps the lib/seo sources for those tokens.)
- G. Full regression: lint, unit, test:db (only if PG safely available),
  test:e2e (HTTP-level; skipped without a running server), build, M2
  scanner regression (transport changed minimally — §2), existing
  diagnostic regressions, PHP `php -l` (no connector change expected).
  Browser E2E: NOT RUN (no browser binary in this VM).

## 11. Explicitly NOT implemented

No automatic SEO cleanup; no deletion of content; no robots.txt,
metadata, redirect, or settings modification; no Search Console
integration; no crawling beyond §3; no sitemap-URL fetching; no
rendering/social-preview verification; no index-status verdicts;
no confirmed-spam/hack claims; no "SEO clean / spam-free" badge;
no connector change (plugin stays 1.7.0, schema stays v7); no
Milestone 16 work; no Tool 10 blocked-execution work.
