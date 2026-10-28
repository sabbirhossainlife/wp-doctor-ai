# Tool 05 — Website Speed Analyzer (Milestone 9)

## Architecture per source (kept separate, never merged)

1. **Basic HTTP preflight** — the existing M2 scanner (`lib/scanner/`,
   `scanUrl`). It validates the URL (WHATWG, http/https, standard ports
   only, no credentials, no private/loopback/link-local/metadata hosts,
   all DNS answers validated, connection pinned to one address, manual
   redirects max 5, HTTPS→HTTP downgrade rejected, no retries, no body
   retention). It returns status, redirect chain, and `durationMs`.
   **`durationMs` is TOTAL response time for the whole preflight,
   redirects included. It is NOT time-to-first-byte (TTFB): the scanner
   has no first-byte timing, so the UI and reports always say "total
   response time" and never TTFB.**
2. **Lab data** — Google PageSpeed Insights API v5, via
   `lib/speed/providers.js` `fetchPsi`. Fixed endpoint
   `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`, params
   `url`, `strategy` (mobile|desktop), `category=performance` only.
   Response validated against the documented v5 shape:
   `lighthouseResult.categories.performance.score` (0–1),
   `lighthouseResult.audits` (object), `finalUrl`, `fetchTime`. Metrics
   come from audit `numericValue` fields; missing/non-numeric values
   become null, never fabricated numbers. PSI's own `loadingExperience`
   field data is deliberately NOT read: Google has announced its
   retirement from PSI, and field data must come from the dedicated
   CrUX API so the two sources stay labelled and separable.
3. **Field data** — Chrome UX Report API, via `fetchCrux`. Fixed
   endpoint `https://chromeuxreport.googleapis.com/v1/records:queryRecord`
   (POST, key as query param, server-side only). Body:
   `{ url | origin, formFactor: PHONE|DESKTOP, metrics:
   [largest_contentful_paint, interaction_to_next_paint,
   cumulative_layout_shift] }`. Response validated as
   `record.metrics.<name>.percentiles.p75` plus histogram buckets
   (accepted under `histogram` or `distributions`, normalized to
   `distributions`) plus `record.collectionPeriod`. Page-level is tried
   first; **only** when the page has no record does the service try the
   origin, and that result is stored and shown with `scope: "origin"`
   and provider status `OK_ORIGIN_FALLBACK` — never presented as
   page-level. No record (404 or empty record) means NO_FIELD_DATA:
   never zero, never a green badge.
4. **Deterministic findings** — `lib/speed/engine.js` + `lib/speed/audits.js`
   (data-driven audit interpreter). Findings carry source
   (HTTP|LIGHTHOUSE|CRUX), category, severity, evidence, recommendation,
   confidence, and related metric. Availability states
   (LAB_DATA_UNAVAILABLE, FIELD_DATA_UNAVAILABLE, PROVIDER_UNAVAILABLE,
   INSUFFICIENT_EVIDENCE) are **notices**, not findings: a missing metric
   alone never creates a finding, per the brief's rule.
5. **AI explanation** — `lib/speed/ai*.js`, mirroring Tools 02–04 and
   reusing the M4 OpenAI provider (`lib/ai/`). Explicit user trigger
   only; regeneration overwrites the single `SpeedAiAnalysis` row;
   deterministic findings are never modified. Validation
   (`ai-validate.js`, schema `speed-1`) rejects unknown/duplicate
   finding references, guaranteed ranking claims, TBT=INP equivalence,
   total-response-as-TTFB claims, and Lighthouse-score-as-ranking-score
   claims. Unconfigured AI returns 503 AI_NOT_CONFIGURED; the
   deterministic report stands alone.

## Metric definitions + thresholds

| Metric | Good | Needs improvement | Poor | Source |
| --- | --- | --- | --- | --- |
| LCP | ≤ 2500 ms | ≤ 4000 ms | > 4000 ms | Field: CrUX p75; Lab: Lighthouse value, labelled LAB |
| INP | < 200 ms | ≤ 500 ms | > 500 ms | Field: CrUX p75; Lab: only if Lighthouse returns an `interaction-to-next-paint` audit |
| CLS | < 0.1 | ≤ 0.25 | > 0.25 | Field: CrUX p75 (unitless); Lab: Lighthouse value, labelled LAB |
| TBT | ≤ 200 ms (advisory) | ≤ 600 ms (advisory) | > 600 ms | Lab only. NOT a Core Web Vital and NEVER INP |

Hard distinctions enforced in code and tests: lab TBT ≠ field INP;
lab ≠ field (never averaged or combined); origin CrUX ≠ page CrUX;
missing CrUX = UNAVAILABLE; Lighthouse score ≠ Google ranking score;
HTTP elapsed ≠ TTFB; opportunity savings are provider estimates only,
never guaranteed gains; opportunity ≠ confirmed defect; high score ≠
all concerns resolved; low score ≠ single root cause; lab/field
disagreement is normal, not an error.

## Environment variables + setup

- `GOOGLE_PAGESPEED_API_KEY` — server-side only. Google Cloud Console:
  create a project, enable the PageSpeed Insights API, create an API key
  (restrict it to that API). Without it, PSI status is NOT_CONFIGURED
  and reports are HTTP/field-only.
- `GOOGLE_CRUX_API_KEY` — server-side only, separate key. Same console
  flow with the Chrome UX Report API enabled. Without it, CrUX status
  is NOT_CONFIGURED and reports are HTTP/lab-only.
- Keys are never exposed in frontend responses, logs, reports, or
  errors. No key exists in this project today (`.env.local` has no
  Google vars); production provider status is therefore NOT_CONFIGURED
  until an admin sets them. **Live Google integration is NOT TESTED —
  all provider tests use controlled mocks.**

## Quotas and limits

- PSI/CrUX quotas are Google-side and are not unlimited or guaranteed
  free; admins should check the current Google Cloud quotas for their
  project and restrict keys. App-side limits: per-user 20 speed checks
  per hour (in-memory, single-process — same limitation as Tools 02–04;
  a shared store is the production replacement), provider timeout ~30 s,
  provider response cap 2 MiB, request body cap 10 KiB, duplicate-submit
  guard (same user + sanitized target + strategy within 60 s returns the
  recent report instead of re-running providers).
- One provider failure never destroys a report: status PARTIAL, other
  sources preserved, per-provider statuses recorded. A user re-run is
  the retry mechanism; there are no silent auto-retry loops and no
  background job queue (the flow is synchronous and bounded).

## Privacy / SSRF safeguards

- The user-submitted URL is re-validated server-side by the M2 scanner
  before any provider call; prohibited destinations are BLOCKED and no
  provider request is made. Redirect targets are re-validated per hop
  by the scanner, including redirect-to-prohibited rejection.
- **Query string ALWAYS stripped** for provider calls and for storage
  (`queryStripped: true` on every report); the fragment is always
  stripped. No opt-in query forwarding exists, so no sensitive query
  value can leak to Google or into a stored report. The stored
  `requestedTarget` is the scanner-redacted URL (host + path only).
- No connector credentials, cookies, Authorization headers, or customer
  credentials are ever forwarded to Google; no user-controlled headers
  exist; provider endpoints and parameters are fixed server-side, so a
  user cannot redirect the call to another host.
- **Google accesses the target from its own infrastructure.** Local
  connection pinning governs only WP Doctor AI's preflight request, not
  Google's Lighthouse/CrUX requests — a public URL is fetched by Google
  from Google's network. This is stated in the UI consent text.
- Tool 05 needs no connector pairing and no website record: it analyses
  a user-submitted URL, and reports are owned by the submitting user
  only (ownership in WHERE, identical 404 for other users' reports).

## Cache policy

**No cross-user cache.** Each report is the requesting user's own row;
no shared cache key exists, so one user's data can never be served to
another by construction. Re-scans create new rows; historical reports
are immutable. (If caching is ever added, it must be keyed on
normalized target + source + strategy + provider config/version +
scope with documented expiry — CrUX collection periods and Lighthouse
freshness differ — and must remain per-user.)

## API

- `POST /api/speed-diagnostics` — body `{ url, strategy }` only;
  client scores/metrics/provider responses ignored. 201 with the
  report (status COMPLETED | PARTIAL | FAILED | BLOCKED), 400 invalid
  input, 429 rate-limited, 401 unauthenticated.
- `GET /api/speed-diagnostics?page=&pageSize=` — own reports, desc,
  pageSize capped at 100.
- `GET /api/speed-diagnostics/[id]` — own report + AI analysis (if any),
  identical 404 otherwise.
- `POST /api/speed-diagnostics/[id]/ai-analysis` — explicit trigger,
  `{ regenerate }` optional; 503 AI_NOT_CONFIGURED when unconfigured.
- `GET /api/speed-diagnostics/[id]/ai-analysis` — stored AI analysis.

## UI

`/tools/website-speed-analyzer` (form with HTTPS/HTTP guidance, strategy
select, third-party processing notice + consent checkbox, duplicate
prevention, honest running/completed/partial/failed/blocked states),
`/tools/website-speed-analyzer/history` (bounded paging),
`/tools/website-speed-analyzer/[id]` (HTTP / LAB / FIELD sections kept
separate, findings with severity/source/evidence/recommendation and
estimated-only savings, availability notices, AI section). Header link
added. No hardcoded or mock historical reports exist in production.

## Versions / configurations actually tested

- Next.js 15.5, React 19, Prisma 6.14, PostgreSQL 16, Node v24.22.1.
- PSI/CrUX: mock-validated only (see `tests/speed-providers.test.js`);
  live integration NOT TESTED (no keys). Scanner preflight: M2 fixtures
  + new service tests with injected preflight mocks.
- Local wp-dev (WP 7.1.3, PHP 8.3.6, WooCommerce 11.2.1, Elementor
  4.3.5, theme Oishi at http://127.0.0.1:8080) is a LOOPBACK target, so
  it is BLOCKED by the scanner by design and cannot be a Tool 05
  target — the E2E test uses exactly that blocked path as its fixture.
  No wp-dev integration run is claimed for Tool 05.

## Limitations

- No local headless browser exists in this VM; lab data comes only from
  Google-hosted Lighthouse via PSI. No automatic optimization, caching
  changes, image replacement, or remote repair is performed or offered.
- CrUX covers only pages/origins with enough real-user traffic; many
  pages legitimately have no field record.
- Lab runs vary run-to-run (simulated network/device, Google-side load);
  a single lab score is not a stable benchmark — re-run for comparison.
- AI explanations are interpretations of the deterministic report, not
  new measurements; provider failures and unconfigured AI leave the
  deterministic report fully usable.
- Browser E2E: NOT RUN (no browser binary in this VM). HTTP-level E2E
  covers auth, validation, blocked-path persistence, list/detail,
  ownership 404, and AI 503.
- Production SaaS domain still unconfirmed (same open item as M4–M8).
