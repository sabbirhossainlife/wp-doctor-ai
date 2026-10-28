# Milestone 9 — Tool 05 Plan: Website Speed Analyzer (written before implementation, 2026-10-27)

## Inspection findings (verified from actual code, not assumed)

- Scanner (M2, `lib/scanner/`): `parseScanTarget` — WHATWG, http/https only,
  standard ports only, credentials rejected, refused suffixes, single-label
  refused. `scanUrl` returns `{ ok, finalUrl, finalStatus, redirectCount,
  chain, durationMs }` where `durationMs` is TOTAL elapsed time for the whole
  scan (including redirects), NOT time-to-first-byte: no socket 'response'
  headers timing exists. Tool 05 therefore labels it "total response time"
  and NEVER TTFB, and does not add first-byte timing (out of scope; the
  brief allows labelling honestly instead).
- Tool 04 template (`lib/elementor/`): `service.js` (ownership in WHERE,
  identical 404, 10 KiB body, per-user in-memory limiter 20/hour),
  `engine.js` (pure rules), `rate-limit.js`, `ai-input.js` / `ai-prompt.js` /
  `ai-validate.js` / `ai.js` (reuses M4 `lib/ai/providers.js` OpenAI strict
  json_schema, `getAiConfig`, shared AI limiter; schemaVersion
  "elementor-1"). `lib/ai/analyze.js`: configured = provider "openai" + key +
  model, placeholders rejected; unconfigured production AI = 503
  AI_NOT_CONFIGURED. `MockProvider` exists in `lib/ai/providers.js` for tests.
- UI template: `app/tools/elementor-layout-checker/{page,[id]/page,history/page}.jsx`,
  `components/ElementorCheckerForm.jsx`, `components/ElementorAiSection.jsx`,
  header links in `components/SiteHeader.jsx`. API routes mirror
  `app/api/elementor-diagnostics/{route,[id]/route,[id]/ai-analysis/route}.js`.
- DB tests run via `scripts/run-db-tests.mjs` (TEST_DATABASE_URL from
  `.env.local`, never printed); E2E tests are HTTP-level only (no browser
  binary in this VM). Unit tests run with `node --test` and are listed in
  `package.json` `test` / `test:e2e` scripts — new test files must be added
  to those scripts.
- `.env.example` currently has NO Google keys; `.env.local` key names are
  checked, never values. No live Google call will be made: no keys exist.

## Provider documentation checked 2026-10-27 (public docs text only)

- PageSpeed Insights API v5: GET
  `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` with
  `url`, `strategy` (mobile|desktop), `category=performance` (repeatable).
  Response: `lighthouseResult.categories.performance.score` (0–1),
  `lighthouseResult.audits` (per-audit `score`, `displayValue`,
  `numericValue`, `numericUnit`, `title`, `description`, `details`),
  `lighthouseResult.finalUrl`, `lighthouseResult.fetchTime`. Key audit IDs
  used: `first-contentful-paint`, `largest-contentful-paint`,
  `total-blocking-time`, `cumulative-layout-shift`, `interactive`,
  `speed-index`, `server-response-time`, `render-blocking-resources`,
  `unused-javascript`, `unused-css-rules`, `uses-text-compression`,
  `uses-long-cache-ttl`, `uses-optimized-images`, `uses-responsive-images`,
  `mainthread-work-breakdown`, `bootup-time`, `largest-contentful-paint-element`.
  Note: PSI also carries `loadingExperience` (CrUX field data) but Google
  has announced its retirement from PSI; Tool 05 does NOT read field data
  from PSI — field data comes only from the dedicated CrUX API, so the two
  sources stay labelled and separable.
- CrUX API: POST
  `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=...`
  with JSON body `{ url | origin, formFactor: "PHONE"|"DESKTOP", metrics:
  ["largest_contentful_paint","interaction_to_next_paint",
  "cumulative_layout_shift"] }`. Response: `record.key`,
  `record.metrics.<name>.percentiles.p75` (75th percentile),
  `record.metrics.<name>.histogram` (buckets with start/end/density;
  some surfaces call this distributions — code accepts both keys and
  normalizes to `distributions`), `record.collectionPeriod`
  `{firstDate,lastDate}`. A missing record (404 / no `record`) means
  NO_FIELD_DATA, never zero. CrUX is a rolling ~28-day window; the
  collection period is stored and shown verbatim.
- Core Web Vitals bands (used exactly as briefed, matching official CWV
  guidance): LCP good ≤2500 ms, needs-improvement ≤4000 ms, else poor;
  INP good <200 ms, needs-improvement ≤500 ms, else poor; CLS good <0.1,
  needs-improvement ≤0.25, else poor. Field classification uses the p75;
  lab classification uses the Lighthouse numeric value and is labelled LAB.
  TBT is a lab-only metric and is NEVER labelled INP.

## Design decisions (simplest compliant choices from the brief)

- Synchronous bounded flow only: preflight → PSI → CrUX, all with
  timeouts; statuses are only COMPLETED / PARTIAL / FAILED / BLOCKED
  (no QUEUED/RUNNING — no async mechanism exists).
- Query string ALWAYS stripped for provider calls and for storage; the
  stored record keeps `requestedTarget` (sanitized, query-stripped, per
  scanner redaction convention) plus `queryStripped: true`. No opt-in
  query forwarding is implemented, so no sensitive query value can leak.
  Fragment is always stripped (scanner already never sends it).
- NO cross-user cache. Each user's report is their own row; no shared
  cache key exists, so no cross-user leakage is possible by construction.
- Provider targets: the FINAL URL from the scanner preflight (after
  redirects, re-validated by the scanner itself) is the provider target,
  shown separately from the user-submitted target.
- One provider failure never destroys the report: status PARTIAL, the
  other source preserved, providerStatuses recorded per provider.
- Keys: `GOOGLE_PAGESPEED_API_KEY` (PSI) and `GOOGLE_CRUX_API_KEY`
  (CrUX), separate, server-only, never in responses/logs/reports. When a
  key is absent the provider status is NOT_CONFIGURED and the report is
  still persisted with whatever sources succeeded (HTTP-only report when
  both are unconfigured — the honest production default).

## Files to create

- `lib/speed/thresholds.js` — CWV bands + classify functions (pure).
- `lib/speed/providers.js` — PSI + CrUX adapters (fixed hostnames,
  timeout ~30 s, response size cap, strict validation, injectable fetch).
- `lib/speed/audits.js` — data-driven audit interpreter (known audit IDs
  mapped to finding templates; unknown IDs preserved generically).
- `lib/speed/engine.js` — deterministic findings from HTTP + lab + field.
- `lib/speed/rate-limit.js` — per-user 20/hour in-memory limiter.
- `lib/speed/service.js` — orchestration + persistence + public views.
- `lib/speed/ai-input.js`, `ai-prompt.js`, `ai-validate.js`, `ai.js` —
  mirror Tool 04; schemaVersion "speed-1".
- `prisma/schema.prisma` + migration `2026102719xxxx_init_m9_speed`
  (SpeedDiagnostic, SpeedDiagnosticFinding, SpeedAiAnalysis).
- API: `app/api/speed-diagnostics/route.js`,
  `app/api/speed-diagnostics/[id]/route.js`,
  `app/api/speed-diagnostics/[id]/ai-analysis/route.js`.
- UI: `app/tools/website-speed-analyzer/{page,[id]/page,history/page}.jsx`,
  `components/SpeedAnalyzerForm.jsx`, `components/SpeedAiSection.jsx`,
  header link in `components/SiteHeader.jsx`.
- Tests: `tests/speed-thresholds.test.js`, `tests/speed-providers.test.js`,
  `tests/speed-rules.test.js`, `tests/speed-ai-validate.test.js`,
  `tests/speed-db.test.js`, `tests/e2e-speed.test.js`; wire into
  `package.json` test/test:e2e scripts and `scripts/run-db-tests.mjs`.
- Docs: `docs/website-speed-analyzer.md`, README M9 section,
  `.env.example` entries.

## Tests to run (never fabricated)

Unit: `npm run lint`, `npm test`; DB: `npm run test:db`;
E2E: `npm run test:e2e` (needs a running dev server on a test port);
build: `npm run build`. Scanner regression: `npm run test:scanner`.
wp-dev (127.0.0.1:8080) used only as a scanner preflight fixture target
if it is up; the preflight itself rejects loopback, so wp-dev is NOT a
valid Tool 05 target — document that: local targets are BLOCKED by design.
