# WP Doctor AI — Milestones 0–1: Foundation + Auth, Database & Dashboard

AI-powered WordPress troubleshooting & expert repair SaaS.
Milestone 0 (foundation) and Milestone 1 (authentication, PostgreSQL,
dashboard, website management) are implemented. No diagnostic tool, scanner,
connector, AI diagnosis, or repair workflow exists yet.

## Prerequisites

- Node.js 24 (verified with Node v24.22.1 on the build machine; Next.js 15
  requires Node 18.18+ — use an LTS release if you differ)
- npm 10 (verified 10.9.4)

## Install

```sh
npm install
```

## Commands

| Command         | Purpose                              |
| --------------- | ------------------------------------ |
| `npm run dev`   | Development server (default: :3000)  |
| `npm run build` | Production build                     |
| `npm run start` | Run the production build             |
| `npm run lint`  | ESLint (flat config, Next.js rules)  |
| `npm test`      | Node test runner (`node --test`)     |

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. All values in
`.env.example` are placeholders only — never commit `.env.local`.

- `DATABASE_URL` — PostgreSQL connection string (unused in Milestone 0;
  Prisma integration lands in Milestone 1).
- `AI_PROVIDER` / `AI_API_KEY` — AI provider name and server-side API key
  (unused in Milestone 0; no AI calls exist yet).
- `SESSION_SECRET` — session secret placeholder (auth lands in Milestone 1).

## Project structure

```text
app/
  layout.jsx          App shell, header, metadata, design-token stylesheet import
  page.jsx            Honest landing-style home page (no fake features)
  globals.css         Tailwind v4 import + design tokens (@theme)
  not-found.jsx       Accessible 404 error-state page
  api/health/route.js Health endpoint: GET -> {status:"ok", service:"wp-doctor-ai"}
components/
  SiteHeader.jsx      Basic navigation (Home, Service status, milestone badge)
  Container.jsx       Reusable responsive page container
lib/
  url.js              Generic isHttpUrl() scheme helper (NOT the scanner)
tests/
  url.test.js         Unit tests for isHttpUrl()
  health.test.js      Health route handler test
```

JavaScript only: `.js` / `.jsx` files. No TypeScript, no `.ts` / `.tsx`
files, no `tsconfig`.

## Database integration strategy (Milestone 1, not installed here)

PostgreSQL + Prisma ORM configured for JavaScript. Milestone 1 will install
Prisma, add the first migration and the first entities (users, roles,
websites), and wire server-side ownership checks. Deliberately **not**
installed in Milestone 0, so the foundation stays minimal and the entity
work is reviewed as its own milestone.

## What Milestone 0 contains

- Next.js 15 App Router foundation, React 19, Tailwind CSS v4
- App shell with design tokens, honest landing page, health endpoint
- ESLint flat config, Node test runner with passing tests
- `.env.example` (placeholders only), `.gitignore`, this README

## What is explicitly NOT built yet

- User accounts, login, dashboard, roles
- Website registration or connection
- Any diagnostic scan, report, or scan history
- WordPress connector plugin (PHP)
- AI diagnosis or AI provider calls
- Repair requests, quotations, approvals, admin workflow
- Payments or subscriptions

## Milestone 1 — Authentication, PostgreSQL & Dashboard

### Auth library selection (evaluated first, per the brief)

- **Chosen: Better Auth 1.7.x + Prisma adapter** (`prismaAdapter(prisma, { provider: "postgresql" })`),
  email-and-password only, with the `nextCookies()` plugin for Next.js App Router.
  Reasons: maintained, self-hosted (sessions in our own PostgreSQL, so logout
  revocation is immediate by deleting the session row), official Prisma adapter,
  documented Next.js App Router handler (`toNextJsHandler`), and it works from
  plain `.js` app source — Better Auth itself is a library dependency, not app
  TypeScript source.
- **Prisma 6.14.0** (not 7.x): the adapter pattern above is proven against the
  Prisma 6 client generation model; pinning 6.x avoids an unproven major-version
  combination. Next 15.5 / React 19 are unchanged from Milestone 0.
- Passwords are hashed by Better Auth (scrypt); the app never sees or stores
  plaintext passwords. Sessions are database-backed cookies (HttpOnly,
  SameSite, Secure in production over HTTPS via the library's cookie defaults).

### Database

- PostgreSQL 16, local cluster. Dev database and a separate test database,
  owned by a dedicated role. Real connection strings live ONLY in `.env.local`
  (mode 0600, gitignored) — never in source, README, or `.env.example`.
- Migrations: `prisma/migrations/` (created by `prisma migrate dev`).
  Models: Better Auth `User`/`Session`/`Account`/`Verification` plus
  `User.role` (default `USER`, client input rejected via
  `additionalFields.role.input: false`) and `Website`
  (id, name, normalizedUrl, userId FK cascade, connectionStatus default
  `NOT_CONNECTED`, createdAt, updatedAt, unique `[userId, normalizedUrl]`).

### URL normalization (lib/websites.js)

Lowercased host, http/https only, no embedded credentials, no fragment,
default ports stripped, trailing slashes removed (root URL has no trailing
slash). The same function validates API input and is unit-tested.

### What Milestone 1 contains

- `/register`, `/login`, `/dashboard` (protected), `/dashboard/websites/[id]`
  (protected, ownership-checked), session-aware header, logout.
- `/api/auth/[...all]` (Better Auth handler) and `/api/websites` CRUD routes
  with server-side session + ownership checks on every operation.
- Dashboard shows real user data only; scan history and repair sections are
  honest "coming later" panels — no fake scans, scores, or revenue.
- Submitted website URLs are **never fetched or scanned** in this milestone.

### Password reset & email verification — NOT CONFIGURED (honest status)

No SMTP provider is configured, so no verification or reset email is sent
and no reset token is ever exposed in a response. Dev approach until a later
milestone configures and tests a provider: create accounts directly in the
dev database flow (register via the UI, which works without verification
because `requireEmailVerification: false`), and test reset only after SMTP
variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
`EMAIL_FROM`) are set and a real delivery test passes. The login page says
this plainly to users.

### Rate limiting — honest scope

Better Auth's built-in limiter is enabled (general rule: 100 requests / 60s
per IP on auth endpoints). It is in-memory and dev-suitable only: it does not
share state across instances, so production needs a shared store (later
milestone). Verified in the installed library source, the built-in SPECIAL
rule overrides the general rule for `/sign-in`, `/sign-up`,
`/change-password`: 3 requests / 10s per IP, with the counter resetting
only after 10s without a request. A dedicated probe
(`tests/rate-limit.test.js`, run separately) observed a 429 within 3 rapid
sign-in attempts, consistent with that rule (the exact boundary was not
isolated: the preceding E2E run's sign-ins fell in the same window).

### Tests

- `npm test` — unit tests (health, URL helper, website normalization).
- `npm run test:db` — Prisma integration tests against the dedicated test
  database (user/website CRUD, unique email, per-user dedupe, ownership
  scoping, cascade delete). It refuses to run without TEST_DATABASE_URL.
- `npm run test:e2e` — HTTP end-to-end tests against a running server
  (`E2E_BASE_URL=...`); skipped without it. These are HTTP-level flows, not
  browser tests: Playwright browser E2E is NOT RUN in this VM (no browser
  binary download available), and is reported as such.

### Still NOT built (after Milestone 1)

Scanner infrastructure, any of the four diagnostic tools, AI diagnosis,
WordPress connector, repair workflow, admin provisioning UI, subscriptions,
payments, email delivery.

## Milestone 2 — Secure Scanner Infrastructure (internal library only)

Full security documentation: `docs/security-scanner.md`. Summary:

- `lib/scanner/`: `url-policy.js` (WHATWG parse, http/https only, ports
  80/443 only), `ip-policy.js` (fail-closed global-reachability
  classification, no new dependency), `dns.js` (all A+AAAA validated, any
  prohibited answer rejects), `transport.js` (per-request subclassed
  Agent pinned to the validated IP; Host + TLS SNI keep the hostname;
  verification never disabled), `scanner.js` (manual redirects, max 5,
  HTTPS→HTTP downgrades rejected, no retries, no body retention),
  `errors.js` (structured codes, redacted logs), `rate-limit.js`
  (per-user/per-IP buckets + bounded concurrency, in-memory default =
  single-process only).
- Node 24 finding: an Agent constructor `createConnection` option is
  silently ignored — pinning must be a subclass override (proven by
  `tests/scanner-transport.test.js` against a local server).
- **No scanner route exists** in this milestone — no public scan form,
  scan history, or report UI. No new database tables, services, or jobs.
  No M1 auth/website code was modified except `package.json` scripts.
- Tests: `npm run test:scanner` (91 tests: URL, IP, DNS, pinning,
  redirects, limits, rate limiting, real-transport proofs).

## Milestone 3 — Tool 01: Website Error Checker

Authenticated users only; no public scan endpoint. See `docs/tool-01.md`
for the full flow, classification table, privacy policy, and limitations.

- `lib/diagnostics/classify.js` — pure mapping from scanner results to
  execution status + diagnostic outcome + deterministic findings. HTTP 500
  is a COMPLETED scan with an error finding, never a scanner failure.
  No TLS detail is claimed (the scanner collects none).
- `lib/scans.js` — `createScan()` lifecycle: RUNNING row → real `scanUrl()`
  (shared in-process `ScanLimiter`, per-user) → classify → findings →
  terminal row, with a finally guard against permanent RUNNING records.
  The scanner is injectable only as a function parameter for tests; no
  env flag or request parameter can substitute an unsafe transport.
- `Scan` + `ScanFinding` tables (migration `20261027110818_init_m3_scans`,
  applied to dev and test DBs). Separate finding rows, not a JSON blob,
  so future reporting can filter findings. Stored targets are redacted
  (protocol + hostname + path only): no query strings, fragments,
  credentials, DNS answers, internal IPs, or response bodies.
- API: `POST /api/scans` (201; 429 for rate/concurrency limits),
  `GET /api/scans` (own scans, default 20 / max 100 per page),
  `GET /api/scans/[id]` (404 for nonexistent or another user's record).
  All enforce `getCurrentUser()` + ownership in the query.
- UI: `/tools/error-checker` (scan form, no fake progress %),
  `/tools/error-checker/history`, `/tools/error-checker/[id]` (report with
  findings, recommendations, and the public-URL limitation note).
  Dashboard shows the 5 most recent scans; header links Error Checker
  when signed in. No future tool is linked as operational.
- Accuracy correction vs the Milestone 3 brief: the brief's suggested
  privacy note said query strings are "stripped before the request".
  That is not what the Milestone 2 scanner does, and this milestone does
  not claim it: the query string IS sent as part of the HTTP request
  target (required to fetch the URL) and is stripped only from everything
  stored or logged. The fragment is never sent. The UI and docs state
  this accurately.
- Tests: `tests/classify.test.js` (pure classification),
  `tests/scans.test.js` (service + DB + SSRF-through-integration, run via
  `npm run test:db`), `tests/e2e-scans.test.js` (HTTP E2E against a
  running server; loopback scan blocked + persisted end to end).

## Milestone 4 — AI Diagnostic Engine (interpretation layer only)

- Provider-neutral adapter (`lib/ai/providers.js`): OpenAI Chat Completions
  with `response_format` json_schema `strict: true` (model id from
  `OPENAI_MODEL` only — never hardcoded), plus a mock provider for tests.
  **No live provider request was executed: no API key is configured.**
- Pipeline (`lib/ai/`): minimized input from stored scan + findings only
  (input.js, 8000-char cap, no secrets/IPs/queries/bodies) → system prompt
  treating evidence as untrusted data (prompt.js) → provider → strict shape
  validation (schema.js) → reference + claim validation (validate.js:
  unknown/duplicate finding ids, TLS-validity claims, named-plugin causes,
  and dangerous actions all reject the whole analysis as INVALID_OUTPUT).
- Service (`lib/ai/analyze.js`): explicit user trigger only; one completed
  analysis per scan (scanId unique); repeat visits return the cached row;
  regeneration requires `{ regenerate: true }`; per-user 10/day in-memory
  limiter (single-process only); provider/validation failures persist a
  FAILED row with a sanitized code (never a permanent RUNNING row, never
  invalid output persisted as success). Deterministic findings are never
  modified.
- API: `POST /api/scans/[id]/ai-analysis` (401 / identical 404 / 409
  non-terminal scan / 429 / 503 AI_NOT_CONFIGURED / 502 provider or
  invalid-output) and `GET` under the same ownership rules. Route loads
  everything from the database; client-supplied evidence is ignored.
- UI: report page gains an AI explanation section (clearly separated from
  verified findings) with generate/regenerate, generating, completed,
  not-configured, failure, and retry states. No unvalidated AI content is
  ever shown; no prompts, keys, headers, or stack traces are displayed.
- Full detail, limits, and remaining risks: `docs/ai-diagnostics.md`.
- Tests: `tests/ai-schema.test.js`, `tests/ai-input.test.js`,
  `tests/ai-providers.test.js`, `tests/ai-validate.test.js` (grounding +
  prompt injection), `tests/ai-db.test.js` (via `npm run test:db`),
  `tests/ai-e2e.test.js` (HTTP E2E; honestly expects 503 AI_NOT_CONFIGURED
  without a live key). Browser Playwright E2E was NOT RUN (no binary in
  this VM).

### Still NOT built (after Milestone 4)

Tool 02/03/04, WordPress connector, repair workflow, admin provisioning
UI, subscriptions, payments, email delivery, live AI provider integration
(no key configured), and any public scanner endpoint.

## Milestone 5 — Secure WordPress Connector (PHP plugin + SaaS)

- Plugin: `wordpress-plugin/wp-doctor-ai-connector/` (main file,
  admin page, API client, read-only snapshot collector, uninstall
  cleanup). Build an installable ZIP with
  `sh wordpress-plugin/build-zip.sh` (output is a build artifact in
  /tmp by default, never the source of truth). Tested on local
  WordPress 7.1.3 + PHP 8.3; portable syntax targets PHP 7.4+.
- SaaS models: `ConnectorPairingIntent` (code hash only, 10-minute
  expiry, single-use, attempt-capped, atomic consumption),
  `WebsiteConnection` (credential hash only, ACTIVE/REVOKED),
  `ConnectorRequestNonce` (per-connection uniqueness),
  `ConnectorDiagnosticSnapshot` (latest only, replace never
  accumulate). `Website.connectionStatus` becomes CONNECTED only
  after successful pairing.
- API: `POST /api/connector/pairing-intents` (session + ownership,
  code returned once), `POST /api/connector/pair` (code-gated;
  identity from strings only, never fetches the site URL),
  `POST /api/connector/diagnostics` (Bearer + ±300 s timestamp +
  per-connection nonce, 64 KiB cap, strict snapshot schema),
  `POST /api/connector/connections/[id]/revoke` (session + ownership).
  Pairing code: 160-bit entropy; connector credential: 256-bit
  entropy; both stored only as SHA-256 hashes.
- Plugin config: `WP_DOCTOR_AI_API_BASE_URL` constant only (no
  admin-editable destination); https in production, loopback http
  only with `WP_DOCTOR_AI_DEV_MODE`. Production SaaS domain is
  unconfirmed and must be supplied by deployment.
- Tests: `tests/connector.test.js` (via `npm run test:db`),
  `tests/php-connector.test.php` + `tests/php-connector-devmode.test.php`
  (standalone, stubbed WordPress functions; phpunit not available in
  this VM), plus a real wp-dev integration pass (plugin activated on
  WP 7.1.3, pairing + snapshot + revocation verified live).
- Full detail: `docs/connector.md`.

### Still NOT built (after Milestone 5)

Tool 02/03/04, repair workflow, admin provisioning UI, subscriptions,
payments, email delivery, live AI provider integration (no key
configured), scheduled/background snapshot sync, and any public
scanner endpoint.

## Milestone 6 — Tool 02: Plugin & Theme Conflict Checker

- Deterministic rule engine (`lib/conflict/engine.js`, pure functions,
  no AI dependency): Rules A (plugin PHP-minimum mismatch), B (plugin
  WordPress-minimum mismatch), C (declared dependencies, only from the
  WP 6.5+ "Requires Plugins" header), D (active entry without matching
  inventory metadata, incl. duplicates), E (cached update available —
  never a vulnerability claim), F (theme compatibility + parent-theme
  distinction; theme mismatches are reported here, not duplicated under
  A/B), G (user-reported symptom as context only, never a cause),
  H (insufficient evidence / skipped rules). Version comparison is
  numeric with pre-release suffixes; malformed versions skip the rule
  with a recorded reason, never an alphabetical compare. Hard
  invariants: two active plugins alone never yield a confirmed
  conflict; a post-update symptom never proves causation; a version
  mismatch is a compatibility finding, not an invented crash; no logs
  means no log claim; no TLS data means no TLS finding.
- Snapshot v2 (backward-compatible): the connector plugin is now
  1.1.0 and emits `schemaVersion: 2` — all installed plugins
  (`plugins[]` with active/networkActive/muPlugin flags, header
  requirements, dependency slugs, cached update info) plus a rich
  `theme` object — while keeping the v1 `activePlugins`/`activeTheme`
  fields. The server validator accepts v1 AND v2; v1 snapshots run
  with degraded rules (A/B/C/E cannot run → a single
  INSUFFICIENT_EVIDENCE "extended snapshot required" finding; D/H
  still apply). Update info comes only from the cached
  `update_plugins` site transient (read-only); the collector never
  calls an update refresh. Header names verified against local
  WP 7.1.3 source ("Requires at least", "Requires PHP",
  "Requires Plugins").
- Freshness: `CONFLICT_SNAPSHOT_MAX_AGE_MS` (default 24 h). A missing,
  invalid, unsupported, or stale snapshot blocks the run with a 422
  and re-sync instructions (open the connector admin page in WordPress
  and explicitly request a new diagnostic sync). Blocked runs persist
  NO diagnostic row, and no hidden remote sync exists.
- Database (migration `20261027140056_init_m6_conflict`):
  `ConflictDiagnostic` (bounded snapshot COPY — never an FK to the
  live latest-only snapshot row — symptom category allowlist,
  server-side redacted error excerpt), `ConflictFinding`, and
  `ConflictAiAnalysis` (schemaVersion "conflict-1", UNIQUE per
  diagnostic). AI output never modifies deterministic findings.
- API: `POST /api/conflict-diagnostics` (10 KiB body limit; only
  websiteId/symptomCategory/symptomDescription/errorExcerpt read;
  client snapshot/connectorId/ownerId ignored; per-user in-memory rate
  limit, 20/hour, documented single-process), `GET`
  `/api/conflict-diagnostics` (own only, bounded paging),
  `GET /api/conflict-diagnostics/[id]` (ownership in WHERE, identical
  404), `GET /api/conflict-diagnostics/snapshot?websiteId=` (own
  website only; versions, inventory, theme, freshness; no secrets),
  `POST/GET /api/conflict-diagnostics/[id]/ai-analysis` (explicit
  trigger only; validated against real finding IDs — unknown or
  duplicate references reject the whole analysis; 503
  AI_NOT_CONFIGURED when unconfigured; no mock content in production).
- UI: `/tools/plugin-theme-checker` (website select with connection +
  freshness badge, snapshot review, symptom form with secret warning,
  explicit Run button with loading state and duplicate-submit
  prevention, "the live site is not modified" notice),
  `/tools/plugin-theme-checker/history`,
  `/tools/plugin-theme-checker/[id]` (deterministic findings and AI
  interpretation in SEPARATE sections, plus manual-only safe next
  steps). Dashboard header links the checker when signed in.
- Tests: `tests/conflict-rules.test.js` (16 rule/version cases +
  invariants), `tests/conflict-ai-validate.test.js` (12 cases),
  `tests/php-conflict.test.php` (21 stub checks),
  `tests/conflict-db.test.js` + `tests/conflict-connector.test.js`
  (via `npm run test:db`), `tests/e2e-conflict.test.js` (HTTP level,
  7 cases), plus a real wp-dev integration pass (v2 plugin → pair →
  sync → diagnostic; wp-dev restored clean afterwards). Browser E2E:
  NOT RUN (no browser binary in this VM) — never claimed otherwise.
- AI config status: no AI key is configured in this deployment, so
  production AI interpretation returns 503 AI_NOT_CONFIGURED and the
  deterministic report stands alone. Production SaaS domain is still
  unconfirmed (see Milestone 5 note).
- Full detail: `docs/plugin-theme-checker.md`.

## Milestone 7 — Tool 03: WooCommerce Checkout & Payment Diagnostics

- Read-only store inspection, mirroring Tool 02's structure: deterministic
  rule engine (`lib/woocommerce/engine.js`, Rules A–K), 24 h freshness
  (`WOO_SNAPSHOT_MAX_AGE_MS`), bounded snapshot COPY in
  `WooCommerceDiagnostic` (migration
  `20261027142903_init_m7_woocommerce`, dev + test DBs), finding + AI
  models, and API/UI mirroring Tool 02.
- Snapshot v3 (connector plugin 1.2.0, backward-compatible: v1/v2 still
  validate and degrade to Rule K insufficient evidence, never "WooCommerce
  disabled"): WooCommerce presence/version, cart/checkout/my-account page
  assignment + status + block/classic classification (page bodies never
  stored), and registered gateway ids/titles/enabled flags. Block
  compatibility is reported UNKNOWN for every gateway from the current
  collector: WooCommerce declares `cart_checkout_blocks` compatibility per
  plugin file, not per gateway, and its default is COMPATIBLE, so no
  trustworthy gateway-level mapping exists in the admin sync context — the
  validator/engine accept SUPPORTED/UNSUPPORTED for a future trustworthy
  source, but the collector never invents them. Gateway availability is
  likewise null (not safely determinable without a WC session; never
  guessed from `enabled`), and gateway settings are never read.
- Rules: A missing/inactive, B missing page assignment, C assigned page
  missing/unpublished, D same page for multiple roles (per official
  WooCommerce Pages docs), E block compatibility (declared evidence only;
  classic never recommended as a universal fix), F no gateways enabled
  (manual workflows caveat), G unknown block compatibility warning,
  H WooCommerce version requirements, I symptom context only,
  J pending/failed payments (no order inspection, no outcome claim, manual
  gateway-dashboard pathway), K missing information. Hard invariants:
  enabled ≠ payment will succeed; configured page ≠ real checkout works;
  enabled ≠ block-compatible; symptom ≠ verified fact.
- API: `POST/GET /api/woocommerce-diagnostics`, `GET /[id]`,
  `GET /snapshot?websiteId=`, `POST/GET /[id]/ai-analysis` (explicit trigger;
  503 AI_NOT_CONFIGURED when unconfigured; validation rejects invented
  payment success, invented order creation/status, credential-validity
  claims, confirmed-cause claims, and dangerous actions). UI:
  `/tools/woocommerce-checkout-checker` (+ history/detail, header link).
  No payment is run, no order is inspected or changed, no site is modified.
- Tests: rule unit tests (39), AI validation tests (12), PHP stub tests
  (13 + 9, plus M5/M6 PHP suites still passing: 22 + 40 + 5), DB tests (13),
  HTTP E2E (blocked-path + auth + validation), plus a real wp-dev
  integration probe (WP 7.1.3 / PHP 8.3.6 / WooCommerce 11.2.1, pages 8/9/10
  distinct + published, cart/checkout block, myAccount classic, cod enabled
  with unknown block compat → engine yields exactly Rule G + Rule I).
  Browser E2E: NOT RUN (no browser binary in this VM) — never claimed
  otherwise. Full detail: `docs/woocommerce-checkout-checker.md`.

## Milestone 8 — Tool 04: Elementor & Layout Checker

- Read-only, diagnostic/advisory only, mirroring Tool 03's structure:
  deterministic rule engine (`lib/elementor/engine.js`, Rules A–J), 24 h
  freshness (`ELEMENTOR_SNAPSHOT_MAX_AGE_MS`), bounded snapshot COPY in
  `ElementorDiagnostic` (migration `20261027151051_init_m8_elementor`,
  dev + test DBs — actual folder name set by `prisma migrate dev`),
  finding + AI models, and API/UI mirroring Tool 03.
- Snapshot v4 (connector plugin 1.3.0, backward-compatible: v1–v3 still
  validate and degrade to Rule J insufficient evidence, never "Elementor
  missing"): Elementor Free/Pro status derived ONLY from the existing
  plugin inventory (slug OR display name; Pro never assumed from Free),
  plus configured environment values only (`phpMemoryLimit`,
  `wpMemoryLimit`, `maxExecutionTime` — configured, not observed usage).
  Never collected: passwords, cookies, keys, credentials, post bodies,
  page HTML, logs, user info, order data, screenshots, console output.
- Rules: A missing/inactive (explicit v4 state only), B Pro status
  (version information only; both installed+active is NOT a conflict; no
  version-pair rule encoded), C declared PHP/WP requirements (plugin
  headers; mismatch = POTENTIAL warning, never a confirmed crash),
  D memory warning band (below 256 MB configured = POTENTIAL warning,
  never proof of exhaustion; unavailable = insufficient evidence),
  E editor/preview symptom context only (post-update ≠ causation; Safe
  Mode = editor troubleshooting mechanism, never a guaranteed fix),
  F URL mismatch (protocol/hostname only; subdirectory legitimate),
  G conflict candidates only (Tool 02 concept; candidate ≠ confirmed;
  no isolation performed, nothing deactivated, no theme switched),
  H JS/CSS errors (no console data exists — user excerpt is untrusted
  context only, never verified), I frontend layout (configuration cannot
  prove visual correctness; no rendering test; visual UNVERIFIED),
  J insufficient evidence. Hard invariants: installed ≠ working;
  Pro installed ≠ version conflict; post-update ≠ caused-by-update;
  memory warning ≠ exhaustion proven; HTTP 200 ≠ layout correct;
  user JS error ≠ verified browser error; missing field ≠ negative
  finding; subdirectory ≠ URL mismatch; Safe Mode ≠ universal fix;
  no visual test → visual unverified; candidate ≠ confirmed conflict.
- Documented sources (checked 2026-10-27): Elementor Help Safe Mode /
  Preview Could Not Be Loaded / Safe Mode Not Solving (editor-only scope,
  memory 256M/512M, matching Site/WordPress URLs); Elementor system
  requirements as quoted by secondary sources on 2026-10-21 (WP 6.5–6.8+,
  PHP 7.4 min / 8.3+ recommended, WP memory 256 MB / 512 MB recommended /
  768 MB best) — because sources differ, the engine uses plugin-declared
  headers for version rules and 256 MB only as a warning band, never a
  fake precise cutoff.
- API: `POST/GET /api/elementor-diagnostics`, `GET /[id]`,
  `GET /snapshot?websiteId=`, `POST/GET /[id]/ai-analysis` (explicit trigger;
  503 AI_NOT_CONFIGURED when unconfigured; validation rejects invented
  JS/CSS/console claims, invented visual verification, rendering-test
  claims, screenshot claims, Safe-Mode-fixed claims, confirmed
  memory-exhaustion claims, named-plugin confirmed-cause claims, and
  unsafe recommendations). UI: `/tools/elementor-layout-checker`
  (+ history/detail, header link). No screenshot upload is offered:
  visual diagnosis is user-reported symptoms + technical evidence only,
  stated explicitly in UI copy and docs. Full detail:
  `docs/elementor-layout-checker.md`.
- Tests: rule unit tests (31, incl. validator + freshness + memory parsing), invariant tests (11), AI validation tests (11),
  PHP stub tests (elementor 16/16; M5/M6/M7 PHP suites still passing
  after updating their schema assertions for the intentional v4 change
  only), DB tests, HTTP E2E (blocked-path + auth + validation + tool
  pages). Browser E2E: NOT RUN (no browser binary in this VM) — never
  claimed otherwise. wp-dev integration: WP 7.1.3 / PHP 8.3.6 /
  WooCommerce 11.2.1 / Elementor 4.3.5 (Requires PHP 7.4, Requires at
  least 6.8), theme Oishi, home = site = http://127.0.0.1:8080;
  a full pair→sync→diagnostic round trip was NOT completed (see
  `docs/elementor-layout-checker.md` limitations) and is not claimed.

## Milestone 9 — Tool 05: Website Speed Analyzer

- Synchronous, bounded, diagnostic-only: user URL -> M2 scanner preflight
  (SSRF-safe, pinned, redirect-validated; total response time, NEVER
  TTFB — the scanner has no first-byte timing) -> provider target =
  final URL with query + fragment always stripped -> Google PageSpeed
  Insights v5 lab run + Chrome UX Report field data (page first, origin
  ONLY as an explicitly labelled fallback) -> deterministic engine ->
  persisted report + findings. No connector pairing required; reports are
  owned by the submitting user only (ownership in WHERE, identical 404).
- Models (migration `20261027193000_init_m9_speed`, dev + test DBs):
  `SpeedDiagnostic` (statuses actually produced: COMPLETED | PARTIAL |
  FAILED | BLOCKED — no QUEUED/RUNNING, no async mechanism),
  `SpeedDiagnosticFinding`, `SpeedAiAnalysis` (schema `speed-1`,
  regeneration overwrites, never modifies deterministic findings).
  Historical reports are immutable; re-scans create new rows. Never
  stored: query strings, fragments, API keys, credentials, cookies, raw
  provider responses, HTML, bodies. No cross-user cache exists.
- Providers (`lib/speed/providers.js`, server-only, fixed hostnames,
  ~30 s timeout, 2 MiB cap, strict validation, unknown audit IDs
  preserved generically): PSI `runPagespeed` (strategy mobile|desktop,
  category=performance; score 0–1, audits, finalUrl, fetchTime) and CrUX
  `records:queryRecord` (POST, formFactor PHONE|DESKTOP, p75 +
  histogram/distributions + collectionPeriod). Separate keys
  `GOOGLE_PAGESPEED_API_KEY` / `GOOGLE_CRUX_API_KEY` (see `.env.example`);
  no keys exist in this project, so production providers are
  NOT_CONFIGURED and live Google integration is NOT TESTED — all
  provider tests use controlled mocks. One provider failure never
  destroys a report (PARTIAL, other sources preserved); re-run is the
  retry. Per-user limit 20/hour (in-memory, single-process, as Tools
  02–04) + 60 s duplicate-submit guard.
- Metric rules (`lib/speed/thresholds.js`, `lib/speed/engine.js`,
  `lib/speed/audits.js`): CWV bands LCP good ≤2500 ms / NI ≤4000 ms,
  INP good <200 ms / NI ≤500 ms, CLS good <0.1 / NI ≤0.25; field uses
  CrUX p75, lab uses Lighthouse values labelled LAB. Hard distinctions
  tested: lab TBT ≠ field INP (TBT lab-only advisory bands ≤200/≤600),
  lab ≠ field (never merged), origin CrUX ≠ page CrUX, missing CrUX =
  UNAVAILABLE (notice, never a finding, never zero/green), Lighthouse
  score ≠ ranking score, HTTP elapsed ≠ TTFB, savings = provider
  estimates only. Audit mapping covers render-blocking, unused JS/CSS,
  compression, caching, image optimization, server response, and
  main-thread work; passing audits and unknown IDs produce no findings
  (unknown IDs preserved in the lab summary with a note).
- API: `POST/GET /api/speed-diagnostics`, `GET /[id]`,
  `POST/GET /[id]/ai-analysis` (explicit trigger; 503 AI_NOT_CONFIGURED
  when unconfigured; validation rejects invented metrics, TBT=INP
  equivalence, guaranteed ranking claims, total-response-as-TTFB claims,
  and score-as-ranking claims). UI: `/tools/website-speed-analyzer`
  (+ history/detail, header link) with LAB DATA / FIELD DATA / BASIC
  HTTP DIAGNOSTICS kept separate and a third-party processing consent
  checkbox. Full detail: `docs/website-speed-analyzer.md`.
- Tests: thresholds (7), providers PSI+CrUX mocks (8), rules (7),
  AI validation (4), DB (8, incl. origin fallback, partial, BLOCKED,
  FAILED, duplicate guard, query privacy, ownership, AI persist), HTTP
  E2E (blocked-path + auth + validation + ownership + AI 503).
  Browser E2E: NOT RUN (no browser binary in this VM). wp-dev is a
  loopback target and is BLOCKED by design, so no wp-dev integration
  run is claimed for Tool 05.

## Milestone 10 — Tool 06: SSL & Redirect Checker

- Engine (`lib/ssl/engine.js` + `tls-probe.js` + `rules.js`): built on
  the M2 scanner with zero policy duplication — url-policy, ip-policy,
  DNS (all answers validated), and pinned transport reused unchanged.
  One minimal backwards-compatible transport extension
  (`lib/scanner/transport.js`, default off): `captureTls` returns the
  live socket's verified TLS data (protocol, cipher, peer certificate)
  and `ca` passes a test CA through to `tls.connect` only when an
  in-process caller supplies it; production never supplies it and
  `rejectUnauthorized` is never disabled. Every redirect destination
  is fully revalidated before connecting (no re-resolution, no
  auto-follow); HTTPS→HTTP downgrades are recorded and blocked, never
  followed; cross-host redirects are reported neutrally (LOW, never
  "malicious"). Certificate metadata is recorded ONLY when the
  handshake verified; failures contribute only an error code.
- Execution status is separate from findings: BLOCKED (initial policy
  rejection), COMPLETED (terminal response, terminal TLS outcome, or
  observed+blocked downgrade), PARTIAL (chain stopped early),
  FAILED (initial connection failure). Finding codes: TLS_CERT_VALID
  (LOW), TLS_CERT_EXPIRING_SOON (MEDIUM, 30-day threshold),
  TLS_CERT_EXPIRED / NOT_YET_VALID / HOSTNAME_MISMATCH / UNTRUSTED
  (HIGH), HANDSHAKE_FAILED / TIMEOUT / EVIDENCE_INSUFFICIENT
  (MEDIUM), HTTPS_NOT_ENFORCED (MEDIUM), HTTP_TO_HTTPS_REDIRECT
  (LOW), REDIRECT_CHAIN_OK (LOW), DOWNGRADE_DETECTED_BLOCKED (HIGH),
  REDIRECT_LOOP / MAX_REDIRECTS_REACHED /
  REDIRECT_DESTINATION_REJECTED / NETWORK_OR_TIMEOUT /
  INCOMPLETE_EVIDENCE (MEDIUM), CROSS_HOST_REDIRECT (LOW, neutral).
- DB (`prisma/migrations/20261027230000_init_m10_ssl`):
  SslRedirectDiagnostic (sanitized target, execution status, summary,
  TLS outcome, redirect chain, limitations; websiteId nullable,
  ownership-verified) + SslRedirectFinding + SslRedirectAiAnalysis
  (`ssl-1`, regeneration overwrites). Historical reports immutable.
  Note: the migration folder was renamed from its generated
  20261027160940 timestamp so it sorts after M9's 20261027193000
  folder (shadow replay otherwise applies M10 before M9 and fails on
  the speed table); the test-DB history row was renamed to match.
  It also drops a stray DEFAULT on speed_ai_analysis.updatedAt left
  by the M9 file (client-side @updatedAt unaffected). A stale
  rolled-back M9 history row (0 steps, old checksum) was removed
  from both local DBs so `migrate dev` could proceed; the finished
  M9 entry is untouched.
- API: `POST/GET /api/ssl-redirect-diagnostics`, `GET /[id]`,
  `POST/GET /[id]/ai-analysis` (explicit trigger; 503
  AI_NOT_CONFIGURED when unconfigured; AI input built only from
  stored rows with unverified cert fields nulled; banned claims
  include cross-host-as-malicious, downgrade-as-compromise, and
  guaranteed-security claims). URL-only input with an optional
  owned-website selector: when websiteId is supplied the server uses
  ONLY that owned record's stored URL. UI:
  `/tools/ssl-redirect-checker` (+ history/detail, header link) with
  per-hop chain visualization, real running state, no fake progress.
  Full detail: `docs/ssl-redirect-checker.md` (+ plan in
  `docs/tool06-plan.md`).
- Tests: TLS core (9, REAL tls.connect verification against
  openssl-generated fixtures: valid, expired, not-yet-valid,
  mismatch, self-signed, handshake failure, timeout, pinned-IP SNI,
  strict no-verification-disable assertion), engine logic (16, fake
  transport/resolver plumbing, labelled), integration (7, REAL engine
  + pinned transport on ports 80/443 with a test-only in-process
  `testPin` seam for loopback fixtures — never set by service or
  routes), AI validation (5), DB (7, incl. website ownership, client
  data ignored, query privacy, AI persist/503), HTTP E2E (4, incl.
  loopback BLOCKED, auth, validation, cross-user 404, AI 503).
  Full regression: lint clean, unit 340/340, scanner 91/91, DB 92/92,
  build passes, PHP suites unchanged (see report for counts).
  Browser E2E: NOT RUN (no browser binary in this VM). wp-dev is a
  loopback target and is BLOCKED by design, so no wp-dev integration
  run is claimed for Tool 06.

## Milestone 11 — Tool 07: Contact Form & Email Checker

- Connector plugin 1.3.0 → 1.4.0, snapshot schema v4 → v5
  (`contactForms[]`, `mailTransport[]`, domain-only `senderDomain`
  block). Server validator accepts v1–v5; v1–v4 validate exactly as
  before and yield INSUFFICIENT_EVIDENCE for Tool 07's snapshot
  sections, never "plugin broken". Pairing/auth/replay/size/identity/
  revocation unchanged; sync stays admin-triggered only.
- Adapters: Contact Form 7 COMPLETE (verified against real CF7 6.2.3
  source: `wpcf7_contact_form` posts via `find()`, capped at 200,
  sender/recipient presence, literal-sender domain only); WP Mail SMTP
  PARTIAL, fixture-verified only (published `wp_mail_smtp` option
  schema; mailer identifier, from-email domain, presence booleans
  only — not installed on wp-dev, so not live-verified); WPForms,
  Gravity Forms, Ninja Forms, Fluent Forms, Elementor Pro forms,
  FluentSMTP, Post SMTP recognised as UNSUPPORTED (no counts/config
  claims); unknown/custom forms collapse to one `unknown` UNSUPPORTED
  entry, never "no forms exist". Sentinel-secret PHP assertions prove
  no secret, host, username, recipient, subject, body, submission, or
  entry ever reaches the snapshot.
- Engine (`lib/contact-email/`): deterministic rules with CONFIRMED /
  POTENTIAL / INSUFFICIENT_EVIDENCE evidence status; execution status
  separate (COMPLETED, PARTIAL on DNS failure, FAILED; stale snapshot
  blocks at 422 with no row, mirroring Tools 02–04/06). Public DNS via
  injectable resolver (5 s/query, ≤3 queries, ≤50 records, 512-char
  excerpts): SPF presence/multiple/three checked anomalies only (no
  lookup-limit or chain evaluation), DMARC parse with p=none as
  MONITORING (never an error, never an auto enforcement
  recommendation), DKIM only with a validated selector (never guessed,
  never declared missing from an unknown selector). Default email
  domain = snapshot/target host minus one leading `www.`, only if a
  valid multi-label public domain. `DELIVERY_NOT_VERIFIED` (LOW) is
  attached to every COMPLETED report; the flow contains no send,
  submit, SMTP-connection, or mutation path at all.
- DB (`prisma/migrations/20261028001000_init_m11_contact_email`,
  sorts after M10): ContactEmailDiagnostic (websiteId nullable,
  ownership-verified; bounded snapshot copy + capped public TXT
  observations only) + ContactEmailFinding + ContactEmailAiAnalysis
  (`contact-email-1`, regeneration overwrites). Historical reports
  immutable. Note: the folder was first generated with a UTC timestamp
  sorting before M9/M10 and was renamed before any data existed; both
  fresh local databases were then migrated from scratch (the VM wipe
  had already emptied them — no user data was deleted).
- API: `POST/GET /api/contact-email-diagnostics`, `GET /[id]`,
  `POST/GET /[id]/ai-analysis` (explicit trigger; 503
  AI_NOT_CONFIGURED when unconfigured; banned claims include delivery/
  submission verification, DKIM-missing from unknown selector,
  guaranteed acceptance, auto DMARC enforcement, proven root cause).
  websiteId path uses ONLY the owned record's URL + latest snapshot
  (24 h freshness gate); URL-only path runs DNS checks with
  insufficient-evidence form/mail sections. UI:
  `/tools/contact-email-checker` (+ history/detail, header link) with
  Observed / DNS / Potential / Not-checked sections and a DKIM
  selector field that explains when it is useful. Full detail:
  `docs/contact-email-checker.md` (+ plan in `docs/tool07-plan.md`).
- Tests: unit 21 (domain/DNS fixtures/rules/validator/AI validation),
  PHP suites 122 total incl. new 17-test contact-email suite (all
  pass), DB 8/8 for Tool 07 (inside test:db 100/100), HTTP E2E 3/3
  (loopback URL-only run, auth, AI 503 — requires BETTER_AUTH_URL to
  match the E2E base). Full regression: lint clean, unit 361/361,
  scanner 91/91, build passes. Browser E2E: NOT RUN (no browser binary
  in this VM). No live email was sent and no form was submitted
  anywhere in this milestone (no send/submit code path exists; tests
  assert the bound).

## Milestone 12 — Tool 08: Security & Vulnerability Scanner

- Connector plugin 1.4.0 → 1.5.0, snapshot schema v5 → v6 (new section
  only: `securityIndicators {wpDebug, wpDebugDisplay, wpDebugLog,
  disallowFileEdit}` each `yes|no|unknown`, collected ONLY from runtime
  constants via `defined()` — never wp-config.php contents, options,
  users, or secrets). Server validator accepts v1–v6; v1–v5 validate
  exactly as before and yield INSUFFICIENT_EVIDENCE for hardening
  checks only, never a secure configuration. Pairing/auth/replay/size/
  identity/revocation unchanged; sync stays admin-triggered only.
  Existing PHP stub suites' v5 schema expectations were updated
  in-scope to v6 (the only pre-existing PHP failures, all schema
  assertions); the conflict suite's log-collection guard was refined
  to ban actual log-file reading rather than the `WP_DEBUG_LOG`
  constant name, which v6 reads as a flag only.
- Vulnerability intelligence (`lib/security/provider.js`): replaceable
  adapter + normalized advisory model. Active provider is
  WPVulnerability (`https://www.wpvulnerability.net`, fixed host,
  keyless core/plugin/theme endpoints, no user-supplied base URL).
  Verified 2026-10-28 from this VM with keyless live GETs (akismet,
  core 5.8.2, unknown slug) and from its docs/licensing page (open
  and free API; attribution link requested; EUPL v1.2 work). No
  published rate limit was found, so the adapter imposes its own
  bounds (8 s timeout, 512 KiB response cap, 60 components/scan,
  concurrency 2). WPScan is NOT an active provider: its free tier is
  non-commercial only and commercial SaaS use needs a paid Enterprise
  licence + token, neither of which exists here — configuring it
  yields PROVIDER_UNAVAILABLE with that explanation. Only minimal
  advisory references are stored (uuid, title, provider range,
  fixed version only where derivable, CVSS only when supplied,
  source links/dates only when supplied, retrieval timestamp);
  full provider responses are never stored or redistributed.
- Version matching (`lib/security/versions.js`, reusing the M6
  comparator for standard versions only): supported WPVulnerability
  operator ranges are min gt/ge + max lt/le/eq (either bound may be
  open); `unfixed` means no fixed version. `fixedVersion` is derived
  ONLY for max `lt` (the bound is the first fixed version); for `le`
  it is unknown and never fabricated. Prerelease/dev/nonstandard/
  missing versions → COMPONENT_VERSION_UNKNOWN (never matched, never
  cleared); unparseable ranges → INSUFFICIENT_EVIDENCE for that
  advisory; plugins match by canonical slug + version (display names
  never match); themes have no slug in the snapshot, so theme
  advisories are COMPONENT_IDENTITY_UNCERTAIN, never name-matched.
  Core advisories are version-specific (the core endpoint is
  per-version). Provider failure/rate-limit/timeout → PARTIAL report
  with an explicit provider limitation, never a clean scan.
- Passive HTTP checks (`lib/security/http.js`, through M2 pinned
  components only — URL policy, DNS + IP policy, pinned transport;
  no second network stack, no unrestricted fetch): homepage security
  headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options or
  effective CSP frame-ancestors, Referrer-Policy,
  Permissions-Policy — missing = MISSING, weak only for narrow rules
  such as HSTS max-age < 31536000 or CSP wildcard/unsafe-inline);
  XML-RPC unauthenticated GET observation only (200/405 =
  responds; disabling is NOT auto-recommended); a SMALL FIXED
  sensitive-path list (`/.env`, `/.git/HEAD`, `/wp-config.php.bak`,
  `/wp-config.php~`, `/wp-content/debug.log`, `/debug.log` — no
  crawling, no enumeration, no traversal, no port scanning).
  Body-evidence design (option (a)): `pinnedRequest` gained an
  opt-in `captureBodyBytes` (default off, M2 behaviour unchanged);
  only sensitive-path probes capture ≤4 KiB, classify immediately
  against per-path signatures, and discard the body — only the
  sanitized classification is persisted, never body text or
  secrets. 200 + signature = CONFIRMED; 200 without signature =
  POSSIBLE_EXPOSURE; non-200 = not observed (403/404 alone never
  prove absence). Same-host redirects only (max 3); cross-host
  redirects are never followed. No new TLS certificate findings
  (Tool 06 owns those).
- Scope: full scans require an owned registered website + fresh
  (24 h) snapshot; stale/missing/invalid → 422 with re-sync
  instructions and no row persisted. There is NO URL-only full
  vulnerability scan and NO arbitrary-URL comprehensive scanning.
  Client URL/inventory/versions/findings/provider data are ignored
  or rejected. The flow contains no login, brute-force, form-submit,
  upload, exploit-payload, activation, deactivation, update, delete,
  or mutation path at all. Update status comes from snapshot cached
  metadata only (outdated ≠ vulnerable; no auto-install).
- DB (`prisma/migrations/20261028010000_init_m12_security`, sorts
  after M11; the folder was first generated with a UTC timestamp
  sorting before M11, then rolled back from both local databases
  and recreated with the later timestamp before any Tool 08 data
  existed — no user data was deleted): SecurityDiagnostic (bounded
  inventory/advisory/provider/HTTP summaries, sanitized HTTP
  observations only) + SecurityDiagnosticFinding (advisory fields:
  advisoryId, cveId, sourceUrl, fixedVersion, retrievedAt) +
  SecurityAiAnalysis (`security-1`, regeneration overwrites).
  Historical reports immutable; bounded pagination.
- API: `POST/GET /api/security-diagnostics`, `GET /[id]`,
  `POST/GET /[id]/ai-analysis` (explicit trigger; M4 adapter;
  sanitized bounded evidence only; AI validates refs against stored
  finding IDs and never alters deterministic results; 503
  AI_NOT_CONFIGURED when unconfigured; banned claims include
  100%-secure, no-vulnerabilities, proven exploitation, compromise,
  and automatic XML-RPC disabling). UI:
  `/tools/security-scanner` (+ history/detail, header link) with
  result categories visually separated (advisory match / outdated /
  hardening / possible exposure / no matching advisory in checked
  sources / not checked / provider unavailable) and no
  "100% Secure" badge anywhere. Full detail:
  `docs/security-scanner.md` (Tool 08 section appended to the M2
  scanner doc) + plan in `docs/tool08-plan.md`.
- Tests: unit 41 new (versions/ranges, provider parsing + doubles,
  rules/headers, HTTP probes, v6 validator, AI validation) inside
  npm test 402/402; scanner regression 91/91; DB 8/8 for Tool 08
  (inside test:db 108/108: ownership, cross-user denial, stale
  blocking, provider-partial, client-override rejection, sentinel
  never stored, AI invariants + unconfigured AI); PHP suites 132
  checks total (incl. new 10-check security suite), all pass; lint
  clean; build passes (security routes + pages present). HTTP E2E
  2 new tests (unauthenticated rejection + login redirect) are
  skipped without a running server (E2E total 40 skipped). Browser
  E2E: NOT RUN (no browser binary in this VM). Live provider:
  3 keyless read-only GETs actually ran (akismet, core 5.8.2,
  unknown slug) to verify schema; no live scan of a real site is
  claimed, and no exploit, login, form-submit, upload, or mutation
  was attempted anywhere. Production AI still NOT_CONFIGURED (503)
  and the production SaaS domain is still unconfirmed.

## Milestone 13 — Tool 09: Malware & Hack Recovery

- Connector plugin 1.5.0 → 1.6.0, snapshot schema v6 → v7 (new optional
  section only: bounded sanitized `malwareScan` summary from a local
  read-only file inspection at sync time, plus an optional theme `slug`
  — the active theme's stylesheet directory name from the theme API,
  never a display-name match). Server validator accepts v1–v7; v1–v6
  validate exactly as before and yield MALWARE_CHECK_NOT_RUN (a
  persisted NOT_RUN report), never "no malware"; a v7 snapshot without
  malwareScan is still valid. Pairing/auth/replay/size/identity/
  revocation unchanged; sync stays admin-triggered only. Existing PHP
  stub suites' v6 schema expectations were updated in-scope to v7
  (schema assertions only).
- Local inspection (`wordpress-plugin/.../includes/class-malware.php`,
  read-only, bounded, admin-triggered): scope is core directories,
  root entries, plugin/theme/mu-plugin directories, and uploads checked
  ONLY for executable-extension files; root comes only from ABSPATH;
  symlinks skipped, never followed; wp-content/cache + upgrade
  excluded; DB files/logs/backups/credentials and directories outside
  WP never read. Limits: 2,500 files, 1 MiB/file, 32 MiB aggregate,
  ~10 s budget, 50 findings, 64 KiB snapshot. PHP source is untrusted
  text — never included, required, evaled, executed, or shelled out
  against. No file contents, snippets, secrets, or absolute paths ever
  leave the site.
- Checksums (connector-side only, comparison local): core from the
  official WordPress.org endpoint
  `api.wordpress.org/core/checksums/1.0/?version=&locale=` (response
  shape verified live 2026-10-28: `{"checksums": {path: md5}}`);
  plugins from `downloads.wordpress.org/plugin-checksums/{slug}/
  {version}.json` (shape per WP-CLI's WpOrgApi source; live plugin body
  not fetched this session, so shape is validated strictly and any
  other shape is REFERENCE_UNSUPPORTED). HTTPS with normal certificate
  validation, no redirect following, 5 s timeout, 4 MiB core / 2 MiB
  per-plugin caps, max 10 plugin manifests/sync, no user-controlled
  provider URLs, no silent fallback. Theme checksums NOT implemented
  (no trustworthy theme endpoint verified) — THEME_CHECKSUM_MISMATCH is
  not emitted. A mismatch is a verified difference, NOT confirmed
  malware; unsupported premium/custom/forked/mu plugins are
  unsupported, never malware.
- Static signatures (small, conservative, context-aware; a single
  generic function name is never proof): MAL-R01 eval+decode, MAL-R02
  superglobal-fed dynamic/shell execution, MAL-R03 decode+decompress+
  execution, MAL-R04 preg_replace /e, MAL-R05 remote fetch + execution.
  Legitimate base64_decode/eval alone produce no finding (asserted).
  Multiple independent rules in one file raise confidence to HIGH as a
  heuristic indicator only — never "confirmed malware".
- SaaS engine (`lib/malware/`, mirroring Tools 02–08): freshness 24 h
  (v1–v7), pure checksum comparison/normalization, pure rules engine,
  recovery-plan generator (stages A–D, instructions only), AI
  input/prompt/validate/service (`malware-1`, 10/day/user, 503
  AI_NOT_CONFIGURED when unconfigured, refs validated, AI never alters
  deterministic results, banned claims include clean/malware-free,
  hacked/infected/compromised, proven exploitation, automatic cleanup,
  and fix-performed claims). Finding codes implemented only where a
  real check supports them (see `docs/malware-recovery.md`); Tool 08
  context appears as a separate triage note, never a merged verdict.
  There is NO automatic cleanup endpoint (asserted in tests), and no
  delete/move/edit/quarantine/restore/permission/credential path exists
  anywhere in the tool.
- DB (`prisma/migrations/20261028020000_init_m13_malware`, sorts after
  M12; applied to dev + test DBs; no past migration edited):
  MalwareDiagnostic + MalwareDiagnosticFinding (finding shape +
  relativePath, componentId, versions, ruleId/checksumId,
  evidenceCategory) + MalwareAiAnalysis (1:1, regeneration
  overwrites). Historical reports immutable; bounded pagination.
- API: `POST/GET /api/malware-diagnostics`, `GET /[id]`,
  `POST/GET /[id]/ai-analysis` (explicit trigger; sanitized bounded
  evidence only). UI: `/tools/malware-recovery` (+ history/detail,
  header link) with the seven result sections in order (verified
  integrity / suspicious indicators / possible compromise — review
  required / no matching indicators in checked files / not checked /
  scan incomplete / manual recovery plan), relative paths only, real
  loading state without fake percentages, and no "100% Clean" /
  "Malware-Free" badge anywhere. Full detail: `docs/malware-recovery.md`
  + plan in `docs/tool09-plan.md`.
- Tests: unit 21 new (rules, checksums, v7 validator, freshness, AI
  validation, no-side-effect static assertions) inside npm test
  423/423; DB 7 new for Tool 09 (inside test:db 115/115: ownership,
  cross-user denial, stale blocking, NOT_RUN behaviour, client-override
  rejection, sentinel never stored, AI invariants + unconfigured AI);
  PHP suites all passing (incl. new malware suite: temp-fixture
  traversal/symlink/limits, signature rules, checksum comparison,
  privacy exclusions, no-modification proof); lint clean; build passes
  (malware routes + pages present). HTTP E2E 3 new tests
  (unauthenticated rejection, login redirect, no-cleanup-endpoint);
  browser E2E NOT RUN (no browser binary in this VM). No live scan of
  a real site is claimed and no real malware sample was used
  (synthetic safe test patterns only). Prisma generate note: in this
  VM the client generate tries to download libquery_engine through
  the egress proxy and fails; copying the already-present
  prisma-engines/libquery_engine.so.node into
  node_modules/prisma/libquery_engine-debian-openssl-3.0.x.so.node and
  pointing PRISMA_*_ENGINE_BINARY at prisma-engines/ makes generate and
  migrate work offline. Production AI still NOT_CONFIGURED (503) and
  the production SaaS domain is still unconfirmed.

## Milestone 14 — Tool 10: Backup, Restore & Migration Assistant

Authenticated, user-controlled, verified — never fake success. Full
detail: docs/backup-restore-migration.md and docs/tool10-plan.md.

### PG preflight (this milestone)
Parent preflight found PostgreSQL fully wiped (no binaries, no data
directory anywhere — a VM wipe, as in M11/M13). Restoration (documented
dev-setup restoration, not a reset): apt installed PostgreSQL 16, a
fresh cluster was started, role `wpdoctor` + `wpdoctor_dev` /
`wpdoctor_test` were recreated from the existing `.env.local` URLs
(passwords never printed), and `prisma migrate deploy` applied M1–M13
cleanly to both. Nothing existing was overwritten (nothing existed).

### What is genuinely implemented
- Backup jobs (DATABASE_ONLY, FILES_ONLY, SITE_DATA_BACKUP) with
  read-only preflight (24 h snapshot freshness, ACTIVE connection,
  multisite detection, storage + encryption readiness, conflicting-job
  check), a persisted state machine (DRAFT … FAILED_REQUIRES_REVIEW,
  invalid transitions rejected), and per-user rate limits.
- A separate bounded chunked transfer protocol (NOT the 64 KiB
  diagnostic endpoint): session-authenticated SaaS endpoints plus
  connector-authenticated `/api/connector/backup-transfer/*`
  (Bearer + ±300 s + per-connection nonce), 1 MiB chunks, per-chunk
  SHA-256, duplicate/missing/reordered detection, total-hash
  verification, disk staging, cleanup on failure/cancel.
- Manifest v1 (bounded, machine-readable, integrity-hashed; tampering
  fails closed) + ZIP entry-list validation (traversal, symlinks,
  duplicates, expanded-size/file-count bombs) before trust.
- AES-256-GCM encryption at rest (Node built-in crypto, random nonce
  per archive, key id only — never the key). Missing/unparsable key
  BLOCKS execution; there is no plaintext fallback. Private local
  storage adapter only (random filenames, mode 0600, never publicly
  served). Production + local storage is BLOCKED; no S3/object adapter
  exists or is claimed. The service holds the key, so this is NOT
  end-to-end encryption — the UI/docs say so.
- Connector 1.7.0 (snapshot schema still v7): admin-triggered backup
  export (manage_options + nonce) — fixed WP file scope, symlinks
  skipped, caches/upgrade dirs excluded, wp-config.php excluded by
  default (explicit same-site-recovery opt-in only, contents never
  shown/logged), bounded $wpdb batch DB export, chunked upload.
- Restore + migration dry-run plans (hashed, versioned) with typed
  confirmation (`RESTORE TO <host>` / `MIGRATE TO <host>`,
  server-validated, one-use 15-minute token bound to the exact plan;
  plan change invalidates it), audit events (no secrets/SQL/contents),
  backup list/detail, one-use 5-minute streamed download tokens,
  owner-initiated deletion (refused while an active job needs the
  backup), and serialization-aware URL rewriting for supported PHP
  serialized types (lengths recomputed in bytes; objects/unsupported
  formats copied verbatim and reported, never corrupted).
- UI `/tools/backup-restore-migration` (+ artifact detail, header
  link) with persisted-state-only progress (no fake percentages) and
  honest blocked states.

### What is explicitly BLOCKED in this milestone (read first)
- LIVE RESTORE EXECUTION and LIVE MIGRATION EXECUTION against a real
  WordPress target. Confirmed jobs end in BLOCKED
  (`RESTORE_EXECUTION_NOT_IMPLEMENTED` /
  `MIGRATION_EXECUTION_NOT_IMPLEMENTED`) with no target mutation,
  because no tested connector restore-apply endpoint and no verified
  pre-restore rollback backup exist yet. A restore/migration is NEVER
  reported COMPLETED here, and no backup is called recoverable until
  integrity + restore compatibility are verified to the supported
  level (integrity is verified on transfer-complete; restore
  compatibility itself awaits the execution implementation).
- Multisite backup/restore/migration (detected, refused — never a
  silent single-site backup); arbitrary user-uploaded ZIP/SQL as a
  trusted backup (only WP Doctor AI transfer packages); production
  operation with local-only storage or without an encryption key;
  any operation on a missing/stale snapshot or inactive connection.
- The SaaS PostgreSQL database is NEVER a WordPress restore target:
  destinations are Website rows (registered WordPress sites owned by
  the user); no code path opens the SaaS database as a WP target.
  This is asserted in DB tests (destination = Website row id; plan
  carries no database URL/credential).

### Versions/configurations actually tested
- Migration `20261028030000_init_m14_backup_restore_migration`
  (BackupArtifact, BackupOperation, BackupOperationEvent,
  BackupDownloadToken), applied to dev + test DBs; no past migration
  edited. Unit 434/434 (incl. 11 new Tool 10 pure tests), DB 120/120
  (incl. 5 new Tool 10 DB tests), PHP backup stub suite green,
  `php -l` clean for all plugin files, lint clean, build green.
  Browser E2E NOT RUN (no browser binary in this VM). No live backup/
  restore against wp-dev was performed (wp-dev was down at preflight;
  watchdog owns its restoration; connector 1.7.0 upload is stub-tested
  and code-reviewed, not live-verified). Production AI still
  NOT_CONFIGURED (503); production SaaS domain still unconfirmed.
  No AI is used by Tool 10.

### Still NOT built (after Milestone 14)

Milestone 15 and any later tool, automated repairs,
remote plugin deactivation/activation, theme switching, remote
settings/DB/file changes, shell commands on customer sites, debug-log
enabling, raw PHP log collection, staging isolation executed by the
app, subscription billing, and any later milestone. Safe next steps
may DESCRIBE manual staging isolation (with backup warning) — the app
never executes it.

## Milestone 15 — Tool 11: SEO Spam & Indexing Checker

Full documentation: `docs/seo-spam-checker.md` (plan: `docs/tool11-plan.md`).
Summary: authenticated, read-only, evidence-based SEO signals — homepage
head analysis (title, description, meta robots, canonical, OG/hreflang
presence) from a bounded 64 KiB prefix via a minimal opt-in transport
extension (`stopAfterCaptureBytes`, default off, M2 behaviour unchanged),
robots.txt (`*` + googlebot groups), sitemaps (index + ≤ 5 children,
≤ 1,000 URLs counted, none stored), redirect classification (cross-host
stops the check, downgrades blocked), and heuristic-only spam indicators
(keyword categories, outbound-link patterns) with false-positive
warnings. Dual path: registered website + fresh (24 h) snapshot for
SEO-plugin evidence (canonical slugs only), or URL-only passive checks.
Search Console is NOT_CONFIGURED: no GSC data is consulted or invented,
and nothing here proves a page is indexed or deindexed, proves SEO spam
or a hack, or proves a site is SEO-clean/spam-free. No site content,
robots.txt, metadata, redirect, or setting is ever modified. AI
explanations use the M4 adapter with a dedicated "seo-1" validator
(banned: index-state guarantees, confirmed spam/hack, clean guarantees,
fix-performed claims); unconfigured production AI returns 503 and the
deterministic report stands alone.

Milestone 14 status is UNCHANGED: still PARTIAL — live restore/migration
execution stays BLOCKED and was not touched by this milestone. Connector
unchanged: plugin 1.7.0, snapshot schema v7, no PHP change.

### Versions/configurations actually tested

- Migration `20261028040000_init_m15_seo` (SeoDiagnostic,
  SeoDiagnosticFinding, SeoAiAnalysis), applied to the dev DB via
  `prisma migrate deploy` and to the test DB by direct SQL (the test DB
  predates migration history — it holds all M1–M14 tables but no
  `_prisma_migrations` table, so `migrate deploy` refuses with P3005;
  the M15 SQL creates only the three new tables and touches no existing
  data). No past migration edited. Unit 471/471 (incl. 37 new Tool 11
  pure tests), scanner regression 91/91, DB 129/129 (incl. 9 new Tool 11
  DB tests), PHP connector/malware/backup stub suites green, `php -l`
  clean for all plugin files, lint clean, build green.
- HTTP-level E2E (Tool 11): 4/4 against a production build on the
  BETTER_AUTH_URL origin (localhost:3000) — register, unauth 401,
  loopback FAILED report, detail + AI 503. Browser E2E NOT RUN (no
  browser binary in this VM). No live SEO check against wp-dev was
  performed (wp-dev's PHP server was down at verification; watchdog
  owns its restoration). Production AI still NOT_CONFIGURED (503);
  production SaaS domain still unconfirmed.

### Still NOT built (after Milestone 15)

Milestone 16 and any later tool, Search Console integration, automatic
SEO cleanup, robots.txt/metadata/redirect/settings modification,
crawling beyond the bounded homepage/robots/sitemap set, sitemap-URL
fetching, rendering/social-preview verification, index-status verdicts,
confirmed-spam/hack claims, "SEO clean / spam-free" badges, automated
repairs, remote plugin deactivation/activation, theme switching, remote
settings/DB/file changes, shell commands on customer sites, debug-log
enabling, raw PHP log collection, staging isolation executed by the
app, subscription billing, and any later milestone. Safe next steps
may DESCRIBE manual staging isolation (with backup warning) — the app
never executes it.

## Milestone 16 — Tool 12: Uptime & Maintenance Monitor

Full documentation: `docs/uptime-monitor.md` (plan: `docs/tool12-plan.md`).
Summary: authenticated, persistent, single-location monitoring for
registered websites ONLY — no arbitrary-URL monitoring exists anywhere
in this tool. Monitors bind to an owned Website record; the target
fingerprint (protocol + host + path, no query) is compared on every
run, and a URL change BLOCKS checks until the owner explicitly
reconfirms the new target (never a silent retarget). Every check runs
through the M2 pinned scanner components (parse, DNS + fail-closed IP
policy, pinned transport, rejectUnauthorized never disabled) with a
same-host-only redirect policy (max 5 hops, cross-host redirects
blocked and never fetched, https→http downgrades blocked). Response
bodies and HTML prefixes are classified and discarded, never stored;
latency is measured with a monotonic timer plus wall-clock timestamps
and is never labelled TTFB. Classification: 2xx UP (high latency
→ DEGRADED), 401/403/404/429 DEGRADED (responding is not downtime),
5xx FAILURE, DNS/TLS/connection/timeout as separate failure reasons,
policy refusals BLOCKED, infrastructure failures UNKNOWN (never
reported as outages). Incident machine: first failure SUSPECTED (no
incident, no alert); failureThreshold consecutive failures (default 2)
open exactly ONE incident; further failures update it; recovery needs
recoveryThreshold consecutive UP checks (default 2) and notifies once.
WordPress maintenance is detected ONLY as 503 + the standard
maintenance-page phrase in a bounded 8 KiB prefix; a generic 503 is a
failure, and connector-reported maintenance does not exist in snapshot
v7 (verified, not invented). Scheduled windows are one-time only
(recurrence not implemented), stored UTC with a validated IANA
timezone, max 14 days; they suppress notifications (recorded as
SUPPRESSED with the window id) while preserving check/incident
history, and a DOWN incident open for more than 6 hours inside a window
still gets one escalation record. Durable scheduling: PostgreSQL
nextCheckAt + atomic lease claims (two concurrent ticks cannot run the
same check), RUNNING rows persisted before probing, stale-lease
recovery to STALE (never a fake failure), bounded batches (10/tick),
no catch-up burst (overdue monitors resume at a bounded pace and gaps
are recorded), 90-day check retention in bounded purge batches.
Trigger: POST /api/monitoring/internal/tick requires the server-only
MONITORING_TICK_SECRET (constant-time comparison); without the secret
it honestly returns 503 SCHEDULER_NOT_CONFIGURED. Email alerts are
EMAIL_NOT_CONFIGURED — no provider adapter exists, no email is ever
claimed sent, wp_mail() is never called, and no monitored site's mail
configuration is used; in-app notifications and history work without
email. No AI is used by this tool. Availability % = UP / (UP + DEGRADED
+ FAILURE) over stored checks only; maintenance, blocked, unknown, and
missing/paused periods are excluded from the denominator and shown
separately — never counted as uptime, never a guaranteed-uptime claim,
never a multi-region claim.

Milestone 14 status is UNCHANGED: still PARTIAL — live restore/migration
execution stays BLOCKED and was not touched by this milestone. Connector
unchanged: plugin 1.7.0, snapshot schema v7, no PHP change. No past
migration edited.

### Versions/configurations actually tested

- Migration `20261028050000_init_m16_uptime_monitor`
  (WebsiteMonitor, MonitorCheck, MonitorIncident, MaintenanceWindow,
  MonitorNotification, MonitoringSchedulerState), applied via
  `prisma migrate deploy` to BOTH the dev DB and the test DB. No past
  migration edited, no data reset.
- Unit 496/496 (incl. 25 new Tool 12 pure tests + 3 added assertions
  for policy-block classification), scanner regression 91/91, DB
  143/143 (incl. 14 new Tool 12 DB tests), PHP connector/malware/backup
  stub suites green, lint clean, build green (includes
  /tools/uptime-monitor and /tools/uptime-monitor/[id]).
- HTTP-level E2E (Tool 12): 6/6 against a production build on the
  BETTER_AUTH_URL origin — register, unauth 401, website + monitor
  creation, loopback target truthfully BLOCKED (policy refusal, not a
  fabricated success), cross-user 404, monitoring health
  (emailConfigured false, EMAIL_NOT_CONFIGURED), window validation,
  pause/resume + manual-check 409. Note: the E2E server must run with
  BETTER_AUTH_URL matching the test origin, otherwise Better Auth
  returns INVALID_ORIGIN (environmental, seen in M13 too). Browser E2E
  NOT RUN (no browser binary in this VM). No live check against wp-dev
  was performed (wp-dev down at verification, curl 000; watchdog owns
  its restoration) — fixtures and stub probes were used instead.
  Production AI still NOT_CONFIGURED (503); production SaaS domain
  still unconfirmed.
- Scheduler status (honest): the tick endpoint and durable claim model
  are implemented and tested, but NO external scheduler is configured
  in any environment here, so recurring monitoring is NOT operational:
  the UI shows "Scheduled monitoring inactive: worker not configured"
  until a real tick runs. Production deployment MUST configure a cron
  (or equivalent) calling the tick endpoint with the secret, or
  scheduled checks will never run.

### Still NOT built (after Milestone 16)

Milestone 17 and any later tool, recurring maintenance windows,
multi-region monitoring, webhooks, email delivery (no provider
adapter), live restore/migration execution (M14 stays PARTIAL),
Search Console integration, automatic SEO cleanup, automated repairs,
remote plugin deactivation/activation, theme switching, remote
settings/DB/file changes, shell commands on customer sites, debug-log
enabling, raw PHP log collection, staging isolation executed by the
app, subscription billing, and any later milestone.
