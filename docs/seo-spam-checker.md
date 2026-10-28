# Tool 11 — SEO Spam & Indexing Checker (Milestone 15)

Authenticated, read-only, evidence-based. Diagnostic only: this tool
never cleans up, deletes content, modifies robots.txt, edits metadata,
changes redirects, or alters WordPress settings — by construction there
is no such code path (see `tests/seo-no-side-effects.test.js`).

## Scope decision + precedents

Following Tool 06 (SSL) for the dual path and Tools 02–04/07/08/09 for
snapshot discipline:

- **websiteId path**: the server loads the canonical URL + latest
  connector snapshot from the DB (ownership in WHERE). Snapshot
  freshness is 24 h (MISSING / INVALID / UNSUPPORTED / STALE → 422 +
  re-sync instructions, NO row persisted). SEO-plugin evidence comes
  from the snapshot only, identified by canonical slug only.
- **URL-only path**: passive HTTP checks only (homepage, robots.txt,
  sitemap). SEO-plugin evidence is NOT_CHECKED, never invented.
- Never: an unauthenticated endpoint; an arbitrary-URL comprehensive
  scan beyond the bounded passive checks below; client-supplied
  inventory, versions, findings, or SEO status as evidence.

## HTML-capture design decision + prefix limit

The M2 scanner discards bodies, and the M12 transport already had an
opt-in bounded first-bytes capture (`captureBodyBytes`, default off).
Tool 11 needs the homepage `<head>`, which sits at the START of the
body — but a normal homepage is often larger than the M2 256 KiB body
cap, and the transport aborted oversized bodies even when only a prefix
was requested. Milestone 15 therefore adds ONE opt-in transport field,
`stopAfterCaptureBytes` (default 0 = off, M2 behaviour unchanged):
once the captured prefix reaches the cap, the transport stops consuming
and resolves successfully with `bodyTruncated: true`. Only Tool 11
passes it. Homepage probe: capture = stop = 64 KiB, maxBytes 256 KiB
(never reached once the stop fires). Every report states the 64 KiB
prefix limit; parsing uses only the head section inside the prefix (up
to `</head>` or `<body>`); if neither terminator is inside the prefix,
`headComplete: false` and missing-tag findings carry LOW confidence
plus a prefix limitation — a tag absent from the prefix is never
reported as absent from the page without that caveat.

## Check catalogue + finding codes + severity/confidence rules

Per-diagnostic request cap: 15 (homepage ≤ 6 hops + robots.txt 1 +
sitemap index 1 + ≤ 5 child sitemaps). Every hop is re-validated
(parseScanTarget → resolveAndValidate → pinnedRequest). No POST, no
cookies, no credentials, no form submits, no crawling of listed pages.

| Check | Codes |
|---|---|
| Homepage fetch + head (title, description, meta robots, canonical, OG presence, hreflang presence) | SEO_TITLE_MISSING, SEO_TITLE_LENGTH_NOTE (also reused for description length), META_DESCRIPTION_MISSING, META_ROBOTS_NOINDEX, X_ROBOTS_NOINDEX, CANONICAL_MISSING, CANONICAL_MISMATCH |
| robots.txt (`*` group + googlebot group if present) | ROBOTS_TXT_MISSING, ROBOTS_BLOCKS_HOMEPAGE, SEO_EVIDENCE_INSUFFICIENT (malformed lines) |
| Sitemap (robots lines + /sitemap.xml; index + ≤ 5 children; ≤ 1,000 URLs counted, none stored) | SITEMAP_MISSING, SITEMAP_UNREACHABLE, SITEMAP_MALFORMED, HOMEPAGE_NOT_IN_CHECKED_SITEMAPS |
| Redirects (max 5, downgrade blocked, cross-host stops the check) | UNEXPECTED_REDIRECT, REDIRECT_CHAIN_NOTE |
| Spam indicators (heuristic only) | SPAM_KEYWORD_INDICATOR, SUSPICIOUS_OUTBOUND_LINK_INDICATOR |
| Search Console | SEARCH_CONSOLE_NOT_CONFIGURED |
| Evidence gaps | SEO_EVIDENCE_INSUFFICIENT, SEO_CHECK_NOT_RUN |

Not implemented: SEO_SNAPSHOT_STALE — stale runs persist NO row (422),
so the code can never appear on a stored report.

Severity/confidence: observed facts are HIGH confidence; heuristic
indicators are LOW confidence and labelled as such; anything not
checked is insufficient evidence, never a pass. noindex on the homepage
and robots-blocking-homepage are HIGH severity impact signals, not
vulnerabilities. Missing title = MEDIUM, missing description = LOW,
missing robots/sitemap = LOW (info-level). Spam indicators = LOW (one
signal) / MEDIUM (multiple independent signals) priority for human
review, never a confirmed-compromise claim. Title/description length
bands (30–60 / 50–160 chars) are WP Doctor heuristics, NOT Google
rules. A scan with no findings NEVER yields an "SEO clean / fully
indexed / spam-free" badge or claim. Nothing here proves a page is
indexed or deindexed: noindex, robots blocks, and sitemap absence are
crawl/indexing SIGNALS.

## robots/sitemap parsing rules + limits

- robots.txt: fetched from the REQUESTED origin only, same-host only,
  64 KiB cap. Only the `*` group + an explicit `googlebot` group are
  evaluated (documented simplification). Sitemap lines: ≤ 20 same-host
  URLs kept, cross-host count only. Homepage path `/` blocked iff the
  longest matching `*` Disallow wins under RFC 9309 longest-match
  (Allow wins ties). Malformed lines → line numbers only, insufficient
  evidence for affected rules. 404 → ROBOTS_TXT_MISSING (info, not an
  error).
- Sitemap: XML parsed strictly as data (bounded `<loc>` extraction
  from a recognised `<urlset>`/`<sitemapindex>` root; nothing
  executed). 256 KiB per file. Missing (no robots line + conventional
  location 404) → SITEMAP_MISSING; robots-listed but unfetchable →
  SITEMAP_UNREACHABLE; unparseable → SITEMAP_MALFORMED. Homepage absent
  → "not found in checked sitemaps", NEVER "not indexed". lastmod
  presence only, never a freshness verdict. Listed pages are never
  fetched.

## Spam-indicator set + false-positive safeguards

- Keyword signals in title + meta description text ONLY. Categories
  (label stored, never the snippet): gambling {casino, poker, slots,
  sportsbook, betting}, pharma {viagra, cialis, levitra, tramadol,
  oxycodone}, adult {porn, xxx, sex chat}, loans {payday loan, quick
  loan, instant loan, cash advance}. Word-boundary matching; one
  category → LOW, ≥ 2 → MEDIUM. False-positive path: legitimate sites
  use these words normally (a pharmacy, a news article, a loan
  provider) — a match is a review prompt, not a verdict.
- Outbound-link signals from the captured prefix ONLY: ≥ 20 external
  links, or ≥ 1 hidden-style link (`display:none` /
  `visibility:hidden`) → LOW indicator. One link is never a verdict.
- Cross-host homepage redirect as a spam-review trigger (never
  "malicious" without further evidence).
- Tool 08/09 advisory context (latest matched-advisory / finding-code
  counts for the same website) is context ONLY: a vulnerability match
  never proves malware, and a clean Tool 09 never proves a clean site.
- A single generic signal NEVER creates a confirmed-spam finding.

## Search Console status

NOT_CONFIGURED. No Search Console API integration exists in this
codebase (verified: the only googleapis references are PageSpeed/CrUX).
Every report states: no Search Console data was consulted, indexing
status is UNKNOWN from this tool's evidence, and manual Search Console
verification (URL Inspection) is recommended. No GSC data is ever
invented.

## SEO-plugin evidence

Canonical slugs only: wordpress-seo, rank-math, all-in-one-seo-pack,
seopress, slim-seo, the-seo-framework. Statuses: ACTIVE /
INSTALLED_INACTIVE / NOT_INSTALLED / NOT_CHECKED (URL-only path, or
schema v1 snapshots which carry display names only — names NEVER
identify a plugin). Sitemap-feature availability is claimed ONLY where
fetched robots/sitemap evidence supports it, never assumed from plugin
presence. WordPress/PHP versions from the snapshot are compatibility
context only.

## API routes

- POST /api/seo-diagnostics (auth; websiteId and/or url; ≤ 10 KiB body;
  20/hour/user in-memory limit, single-process like Tools 02–10).
- GET /api/seo-diagnostics (own only, desc, ≤ 100/page).
- GET /api/seo-diagnostics/[id] (ownership in WHERE, identical 404).
- POST/GET /api/seo-diagnostics/[id]/ai-analysis (explicit trigger
  only; M4 adapter + seo-1 validation; input = sanitized bounded
  findings/metadata ONLY — never HTML bodies/snippets/credentials/
  secrets/absolute paths; AI never changes deterministic observations;
  503 AI_NOT_CONFIGURED when unconfigured; no mock AI in production).

## AI behaviour + 503 status

AI output lives only in SeoAiAnalysis (schema "seo-1", regeneration
overwrites). Banned claims (rejected as INVALID_OUTPUT): index-state
guarantees, fully-indexed claims, SEO-clean/spam-free claims,
confirmed spam/hack/compromise, automatic cleanup/edit instructions,
fix-performed claims. Production AI is NOT_CONFIGURED (no AI vars in
.env.local), so the AI route returns 503 and the deterministic report
stands alone — verified in E2E.

## Privacy / data-minimization safeguards

Never stored: HTML bodies, matched code snippets, secrets, credentials,
absolute paths, query strings, fragments, internal IPs, sitemap URL
lists (counts only), or any client-supplied data. Stored: bounded
summaries, counts, statuses, at most a 300-char page title (page
metadata), spam category labels, and bounded finding evidence.
Historical reports are immutable; re-scans create new rows.

## Security limitations

- Loopback/private/reserved destinations are blocked by M2 policy
  (verified in E2E: a loopback target persists a FAILED report with
  SEO_CHECK_NOT_RUN, never a pass).
- TLS conclusions are NOT duplicated here (Tool 06 owns them); this
  tool records redirect chains and headers only.
- In-memory rate limits are single-process; a shared store is the
  production replacement (same standing limitation as Tools 02–10).
- The `testPin` seam in lib/seo/http.js + engine.js is TEST-ONLY
  (in-process); the service and all routes never pass it.

## Milestone 14 PARTIAL status preserved

Milestone 14 remains PARTIAL: live restore/migration execution stays
BLOCKED and was not touched by this milestone. No Tool 10 code, docs,
or status was altered (only the README "Still NOT built" list now
points past Milestone 15).

## Versions/configurations actually tested

- Migration `20261028040000_init_m15_seo` (SeoDiagnostic,
  SeoDiagnosticFinding, SeoAiAnalysis), applied to the dev DB via
  `prisma migrate deploy` and to the test DB by direct SQL (the test
  DB predates migration history — it holds all M1–M14 tables but no
  `_prisma_migrations` table, so `migrate deploy` refuses with P3005;
  the M15 SQL creates only the three new tables and touches no existing
  data). No past migration edited.
- Unit 471/471 (incl. 37 new Tool 11 pure tests), scanner regression
  91/91 (transport minimally extended, default behaviour unchanged),
  DB 129/129 (incl. 9 new Tool 11 DB tests), PHP connector/malware/
  backup stub suites green, `php -l` clean for all plugin files, lint
  clean, build green.
- HTTP-level E2E (Tool 11): 4/4 against a production build on the
  BETTER_AUTH_URL origin (localhost:3000) — register, unauth 401,
  loopback FAILED report, detail + AI 503. Full-suite E2E results are
  reported separately (pre-existing environmental failures elsewhere
  are not Tool 11 regressions).
- Browser E2E NOT RUN (no browser binary in this VM).
- No live SEO check against wp-dev was performed (wp-dev's PHP server
  was down at verification; watchdog owns its restoration). Live-path
  proof is the local-server engine test (real pinned transport via the
  test-only pin seam) plus fake-probe engine tests.
- Production AI still NOT_CONFIGURED (503); production SaaS domain
  still unconfirmed.
- Connector unchanged: plugin 1.7.0, snapshot schema v7, no PHP change.

## Deployment requirements

- Apply migration `20261028040000_init_m15_seo` (or `prisma migrate
  deploy` where migration history exists). No new environment variables
  are required (SEO_SNAPSHOT_MAX_AGE_MS optionally overrides the 24 h
  freshness window). No new dependencies. AI needs the existing M4
  OPENAI_* configuration to enable explanations; without it the tool
  works fully and AI returns 503.
