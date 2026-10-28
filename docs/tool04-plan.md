# Milestone 8 — Tool 04 Plan (written before implementation, 2026-10-27)

## Inspection findings (verified from actual code, not assumed)

- Snapshot validator (`lib/connector/validate-snapshot.js`): strict allowlist,
  schemaVersion 1 | 2 | 3. v3 = v2 fields + `woocommerce` (required for v3).
  Unknown fields reject the whole payload. Connector plugin is version 1.2.0,
  schema v3, read-only, admin-triggered sync only.
- Tool 03 template (`lib/woocommerce/`): `engine.js` (pure rules, status
  vocabulary CONFIRMED_COMPATIBILITY | POTENTIAL | INSUFFICIENT_EVIDENCE),
  `freshness.js` (24 h, CURRENT/MISSING/INVALID/UNSUPPORTED/STALE, re-sync
  instructions, no row on blocked runs), `service.js` (ownership in WHERE,
  identical 404, 10 KiB body, per-user in-memory limiter 20/hour, bounded
  snapshot COPY), `ai-input.js` / `ai-prompt.js` / `ai-validate.js` / `ai.js`
  (reuses M4 `lib/ai/providers.js`, `getAiConfig`, shared AI rate limiter;
  schemaVersion "woocommerce-1"). Tool 02 (`lib/conflict/`) is the same shape
  plus `redact.js` (reused by Tool 03 and Tool 04) and `versions.js` (real
  version comparator, reused by Tool 03 and Tool 04).
- Tool 01 / M4: `lib/ai/` OpenAI Chat Completions, strict json_schema, model
  ONLY from env `OPENAI_MODEL`; no AI key is configured in `.env.local`, so
  production AI returns 503 AI_NOT_CONFIGURED honestly.
- UI template: `components/WooCommerceCheckerForm.jsx` (website select +
  snapshot preview + symptom form + duplicate-submit prevention),
  `app/tools/woocommerce-checkout-checker/{page,[id]/page,history/page}.jsx`,
  `components/WooCommerceAiSection.jsx`, header links in
  `components/SiteHeader.jsx`. DB tests run via `scripts/run-db-tests.mjs`
  (TEST_DATABASE_URL); E2E tests are HTTP-level only (no browser binary).
- Local wp-dev was DOWN at plan time (curl 000 to 127.0.0.1:8080); it must be
  restarted via `~/workspace/wp-dev/start.sh` standalone (never inside a
  command string containing its own pgrep patterns) before integration work.
  Per M7 notes: WP 7.1.3, PHP 8.3.6, WooCommerce 11.2.1, active theme Oishi,
  active plugins at M7 probe included Elementor — re-verify at integration
  time, do not assume the Elementor version.

## Elementor documentation checked 2026-10-27 (public docs text only, no live browser visit)

- Elementor Help, "How to Fix the 'Preview Could Not Be Loaded' Error" and
  "What is Safe Mode And How to Use It?" (elementor.com/help): Safe Mode
  loads the editor without active theme styles / third-party plugin scripts
  for the signed-in administrator only; live visitors see no change. If the
  editor loads in Safe Mode, a plugin/theme conflict is indicated; if it
  still fails, server configuration / memory / permalink causes are indicated.
  Safe Mode is editor-only: it does not fix live-page layout/styling and
  does not fix widget-panel loading. It is therefore encoded as an editor
  troubleshooting mechanism, NEVER as a guaranteed or universal fix.
- Elementor Help, "Safe Mode Activation Isn't Solving My Problem"
  (elementor.com/help): when Safe Mode does not resolve loading, check WP
  memory limit (256M or 512M in wp-config.php), match Site and WordPress
  URLs under General Settings, the Switch Editor Loader Method setting, and
  browser console / security-header / caching blocks. This supports Rules D
  (memory warning band) and F (protocol/hostname URL mismatch only).
- Elementor system requirements, as reported by multiple secondary sources
  quoting Elementor's published requirements on/around 2026-10-21 (no single
  official requirements page URL was returned by search, so no official URL
  is cited as verified): WordPress 6.5–6.8 or greater (sources differ by
  snapshot date; latest recommended), PHP 7.4 minimum with PHP 8.3+ highly
  recommended, WP memory limit 256 MB for Elementor/Pro, 512 MB recommended,
  768 MB for best performance. Because sources differ and no hard official
  threshold was verified from elementor.com itself at implementation time,
  the engine does NOT hardcode a WP/PHP version cutoff from docs: Rule C
  uses each plugin's own declared `RequiresWP` / `RequiresPHP` headers
  (trustworthy per-site data) against site versions, and Rule D uses the
  256 MB figure ONLY as a warning band (below 256 MB = POTENTIAL warning,
  never "exhaustion proven"; at/above = no finding). Supported version
  range for version-specific rules: whatever the installed Elementor
  plugin's own headers declare — no invented Elementor↔Pro version-pair
  table (none verified), so Pro compat is version-information only.
- No trustworthy source was found for a precise max_execution_time
  requirement, a per-gateway-style Elementor/Pro version-pair matrix, or a
  console-error taxonomy; therefore no rule encodes those. maxExecutionTime
  is collected as evidence only, with no threshold finding.

## Snapshot extension (backward-compatible, versioned)

- Plugin 1.2.0 → **1.3.0**, snapshot **schemaVersion 4**. Validator accepts
  1, 2, 3, AND 4; v1–v3 payloads keep validating exactly as before, and a
  v1–v3 snapshot carries no Elementor data, which the engine reports as
  INSUFFICIENT_EVIDENCE — NEVER "Elementor missing" from absent fields.
- v4 = all v3 fields PLUS `elementor` and `environment` (both required for
  v4, exact-key objects):
  - `elementor`: `{ installed, active, version, pro: { installed, active,
    version }, status: AVAILABLE|NOT_INSTALLED|INACTIVE|UNKNOWN }`.
    Derived ONLY from the existing `plugins[]` inventory: a plugin entry
    matches Elementor Free when its slug is `elementor` OR its display name
    is "Elementor" (case-insensitive); Pro when slug is `elementor-pro` OR
    name is "Elementor Pro". Filename/slug alone is never the sole signal,
    and Pro is never assumed from Free being active. If `get_plugins()` is
    unavailable the status is UNKNOWN; if it ran and no entry matches, the
    status is NOT_INSTALLED. Pro version unavailable → null (UNKNOWN, not a
    conflict). No inventory fields are duplicated.
  - `environment`: `{ phpMemoryLimit, wpMemoryLimit, maxExecutionTime }`,
    each a string from `ini_get('memory_limit')` /
    `WP_MEMORY_LIMIT` if defined / `ini_get('max_execution_time')`, or null
    when unavailable. These are CONFIGURED values, documented as NOT
    observed runtime availability. No other environment data is collected.
- Freshness helper in `lib/conflict/freshness.js` is extended to accept
  schema 4 (a superset of v3); Tools 02/03 behaviour on v1–v3 is unchanged.
  Tool 04 gets its own `lib/elementor/freshness.js` wrapper (same 24 h
  policy, own env var) mirroring Tool 03.
- Never collected: passwords, cookies, keys, credentials, DB credentials,
  full wp-config, arbitrary options, post bodies, full page HTML, raw/PHP
  logs, user info, order data, env vars. URL analysis reuses snapshot
  `homeUrl`/`siteUrl` — no duplication.

## Files to create / modify

- CREATE `lib/elementor/engine.js` (pure rules A–J, `normalizeElementorSnapshot`,
  `runElementorRules`, `parseMemoryLimit`), `freshness.js`, `rate-limit.js`,
  `service.js`, `ai-input.js`, `ai-prompt.js`, `ai-validate.js`, `ai.js`.
- CREATE API routes `app/api/elementor-diagnostics/route.js` (POST + GET
  list), `[id]/route.js` (GET detail), `snapshot/route.js` (GET view),
  `[id]/ai-analysis/route.js` (POST/GET) — mirroring Tool 03 routes.
- CREATE UI `app/tools/elementor-layout-checker/{page,[id]/page,history/page}.jsx`,
  `components/ElementorCheckerForm.jsx`, `components/ElementorAiSection.jsx`;
  MODIFY `components/SiteHeader.jsx` (add Elementor Checker link only).
- CREATE Prisma models `ElementorDiagnostic`, `ElementorDiagnosticFinding`,
  `ElementorAiAnalysis` + relations on User/Website; migration
  `20261027151051_init_m8_elementor`.
  Diagnostic stores a BOUNDED SNAPSHOT COPY, never an FK to the live row.
- MODIFY `lib/connector/validate-snapshot.js` (v4), `lib/conflict/freshness.js`
  (accept v4), connector `class-diagnostics.php` (v4 collectors, version
  bump to 1.3.0 in main file + readme), `package.json` (test scripts),
  `scripts/run-db-tests.mjs` (add elementor db tests), `docs/…` + README.
- MODIFY existing PHP stub tests ONLY to accept the intentional v4 schema
  (schema assertion 3→4, plus v4 field assertions); no existing rule, test
  case, or assertion is removed or weakened.

## Deterministic rules (lib/elementor/engine.js)

- A Elementor missing/inactive — explicit v4 state only; NOT_INSTALLED /
  INACTIVE are confirmed observations, UNKNOWN is deferred to J.
- B Pro status — version information only. Both installed+active ≠ conflict
  (no finding). Pro installed but inactive, Pro active without Free
  available, and Pro version unavailable each get a careful, non-conflict
  finding (POTENTIAL / INSUFFICIENT_EVIDENCE). No version-pair conflict rule.
- C Declared PHP/WP requirements — Elementor Free/Pro `RequiresWP` /
  `RequiresPHP` headers vs site versions via the real comparator; mismatch
  = POTENTIAL warning, never a confirmed crash; malformed versions are
  skipped and recorded (Rule J).
- D Memory-limit warning — effective limit = `wpMemoryLimit` if present,
  else `phpMemoryLimit`; parsed with `parseMemoryLimit` ("-1" = unlimited,
  K/M/G suffixes). Below 256 MB = POTENTIAL warning (configured ≠ observed
  exhaustion); unavailable/unparseable = INSUFFICIENT_EVIDENCE, never assumed.
- E Editor/preview symptom context — symptom is user-reported context only;
  related PHP/env/URL evidence may be related, never a proven cause;
  post-update timing ≠ causation; Safe Mode described only as an editor
  troubleshooting mechanism, never a guaranteed fix.
- F URL mismatch — protocol + hostname of home vs site only; subdirectory
  path difference is LEGITIMATE (never a finding); exact observed values in
  evidence; unparseable URLs deferred to J.
- G Conflict candidates — REUSES the Tool 02 concept without duplicating or
  contradicting its rules: other active non-Elementor plugins are listed as
  CANDIDATES only; conflicting plugin/theme is explicitly NOT established;
  no deactivation or theme switch is performed or claimed.
- H JS/CSS errors — no browser console data exists in this milestone, so
  there is never an independently verified console finding; a user excerpt
  is untrusted context only (presence recorded, text never embedded in a
  finding, never logged).
- I Frontend layout — configuration checks CANNOT prove visual correctness;
  no HTTP-200-as-PASS (no HTTP check exists here at all); visual condition
  is explicitly UNVERIFIED for frontend/both-scope symptoms.
- J Insufficient evidence — legacy snapshot (v1–v3), UNKNOWN status, missing
  version metadata, missing/unparseable memory, malformed-version skips,
  missing inventory for conflict assessment: each states what is missing
  and how to obtain it safely, plus an expert recommendation.
- Status vocabulary: CONFIRMED_COMPATIBILITY | POTENTIAL |
  INSUFFICIENT_EVIDENCE (same literals as Tools 02/03). Every finding:
  ruleId, category, severity, status, title, description, evidence (real
  snapshot fields), referencedItems, recommendation, confidence,
  requiredAdditionalEvidence.

## API / service / AI (mirror Tool 03)

- POST accepts ONLY websiteId, symptomCategory, symptomDescription,
  affectedScope, affectedPages, deviceScope, updatePreceded, startedAt,
  errorExcerpt; client snapshots/inventory/connector IDs/ownership ignored.
  Ownership in WHERE; identical 404; 10 KiB body; in-memory limiter 20/hour;
  422 + re-sync instructions for missing/stale/invalid/unsupported
  snapshots; NO row persisted on blocked runs.
- Symptom categories (15): ELEMENTOR_EDITOR_NOT_LOADING,
  ELEMENTOR_EDITOR_WHITE_SCREEN, ELEMENTOR_EDITOR_GRAY_SCREEN,
  ELEMENTOR_EDITOR_STUCK_LOADING, ELEMENTOR_PREVIEW_NOT_LOADING,
  ELEMENTOR_WIDGET_PANEL_NOT_LOADING, ELEMENTOR_JAVASCRIPT_ERROR,
  ELEMENTOR_CSS_OR_ASSET_ISSUE, FRONTEND_LAYOUT_BROKEN, MOBILE_LAYOUT_ISSUE,
  ELEMENTOR_FREE_PRO_COMPATIBILITY, PHP_OR_ENVIRONMENT_REQUIREMENT,
  WORDPRESS_URL_CONFIGURATION, ISSUE_AFTER_UPDATE, OTHER_OR_UNKNOWN.
  affectedScope: editor/frontend/both/unknown; affectedPages:
  one/many/unknown; deviceScope: mobile/desktop/both/unknown;
  updatePreceded: TRUE/FALSE/UNKNOWN (string; null input = UNKNOWN).
- AI: schemaVersion "elementor-1", input = verified findings + relevant
  inventory (Elementor/Pro versions, theme name/version, other active
  plugin names only) + version/memory info + validated symptom + sanitized
  excerpt + missing-evidence indicators ONLY. Validator rejects unknown /
  duplicate finding refs, invented JS errors, invented visual verification,
  named-plugin confirmed conflicts, Safe-Mode-fixed claims, screenshot
  claims, and unsafe recommendations (permanent deactivation, deleting
  unknown files, overwriting production DBs, unreviewed commands, live-site
  deactivation). AI never overwrites deterministic findings; unconfigured
  production AI → 503 AI_NOT_CONFIGURED; deterministic report stands alone.
  No mock AI content in production routes.

## Tests (all executed, never fabricated)

- A: `tests/elementor-rules.test.js` — 27 rule cases (see task list).
- B: invariants asserted inside the rule tests + `tests/elementor-invariants.test.js`
  (11 invariants, each asserted).
- C: `tests/php-elementor.test.php` (stubbed WP: Free+Pro present, Free
  inactive, Pro absent, Elementor absent, missing env values, secret
  exclusion, explicit sync only) + `php -l` on all plugin files + existing
  M5/M6/M7 PHP suites still pass (schema assertion updated 3→4 only).
- D/E/F: `tests/elementor-db.test.js` (service + AI with MockProvider) and
  `tests/elementor-ai-validate.test.js`.
- G: `tests/e2e-elementor.test.js` (HTTP-level: unauthenticated 401,
  unconnected 422, UI page loads) against a running dev server.
- H: regression `npm run lint`, `npm test`, `npm run test:db`,
  `npm run test:e2e`, `npm run build`.
- Browser tests: NOT RUN (no browser binary in VM) — documented, not faked.
- wp-dev integration: restart wp-dev, verify current Elementor version via
  WP-CLI/REST-independent means available, run the v4 collector against a
  stub-equivalent check, and record what was/wasn't testable. A full
  pair→sync→diagnostic round trip requires the SaaS dev server + plugin
  admin flow; if the browser-less flow cannot complete it, report exactly
  which step blocked and do NOT claim it.
