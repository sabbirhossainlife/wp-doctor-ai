# Milestone 6 — Tool 02 Plan (written before implementation, 2026-10-27)

## Inspection findings (verified from actual code)
- Snapshot v1 (`lib/connector/validate-snapshot.js`, strict allowlist): wordpressVersion,
  phpVersion, homeUrl, siteUrl, pluginVersion, activePlugins[{name, version}],
  activeTheme[{name, version}], multisite, locale. NO requiresWP/requiresPHP,
  NO dependencies, NO update info, NO networkActive/muPlugin flags, NO
  installed-but-inactive inventory.
- `lib/connector/service.js` `storeSnapshot()`: latest-snapshot-only — it
  DELETEs all snapshots for the connection, then inserts one. Consequence:
  past diagnostics MUST NOT reference a snapshot row by FK alone (the row is
  replaced). Decision: each ConflictDiagnostic stores a bounded copy of the
  snapshot payload it was analysed against (snapshotPayload Json) plus
  snapshotSchemaVersion + snapshotReceivedAt. No FK to the live snapshot row.
- AI (M4, `lib/ai/`): `OpenAiProvider` + `getAiConfig` + shared rate limiter
  are reusable; `buildAiInput`/`validateAnalysis` are scan-specific (schema v"1",
  scan finding IDs). Decision: add a conflict-specific input builder + validator
  reusing providers.js, getAiConfig, and the rate limiter; do NOT modify the
  scan schema or scan validation.
- API conventions (`app/api/scans/route.js`): session via `lib/session.js`
  getCurrentUser, ownership in WHERE, identical 404, 10 KiB body limit,
  sanitized errors. UI conventions: `app/tools/error-checker/` pages + history.
- No phpunit/composer/browser binary in VM. Browser E2E = NOT RUN (honest).
- No live AI key (`.env.local` has no AI vars) → production AI = 503
  AI_NOT_CONFIGURED; deterministic engine must work standalone.

## Snapshot extension (backward-compatible, versioned)
- New schemaVersion 2, accepted alongside v1. Validator branches on
  schemaVersion (1 | 2), normalizes v1 to the v2 inventory shape with
  unknown fields as null.
- v2 payload (strict allowlist, same 64 KiB diagnostics cap, minimized):
  all v1 fields PLUS `plugins[]` (ALL installed plugins from `get_plugins()`,
  each {name, version, active, networkActive, muPlugin, requiresWP,
  requiresPHP, dependencies[], updateAvailable, newVersion, updateCheckedAt})
  and `theme` {name, version, parentName, parentVersion, requiresWP,
  requiresPHP}. Keep the v1 `activePlugins`/`activeTheme` fields in v2 too so
  old consumers keep working; the rule engine reads the richer `plugins`/`theme`.
- Collection rules (PHP, `class-diagnostics.php`): active flags from
  `active_plugins` option + `active_sitewide_plugins` (multisite) +
  `get_mu_plugins()`; requires fields from plugin/theme headers
  ("Requires at least" / "Requires PHP"); dependencies ONLY from the WP 6.5+
  "Requires Plugins" header (comma-separated slugs) — if the header is absent
  or unparseable, dependencies = [] and Rule C degrades to INSUFFICIENT_EVIDENCE,
  never invented. Update info ONLY from the cached `update_plugins` site
  transient (read-only); NEVER call `wp_update_plugins()` or any refresh —
  missing/stale update data is reported as unavailable/stale. Verify header
  names against local WP 7.1.3 source before finalizing; null when unavailable.
- Prohibited, unchanged: settings, user data, keys, config, order/customer
  data, post bodies, raw logs, arbitrary options. Plugin version bump to
  1.1.0 only if warranted; document it. Old plugin (v1) keeps pairing and
  submitting; rules degrade gracefully on v1 snapshots.

## Freshness policy
- `CONFLICT_SNAPSHOT_MAX_AGE_MS`, default 24h (single constant, env-overridable).
  Older than 24h = STALE. Missing / invalid / unsupported-schema / stale →
  diagnostic NOT run on stale data as current; API returns bounded status
  (SNAPSHOT_MISSING / SNAPSHOT_INVALID / SNAPSHOT_UNSUPPORTED / SNAPSHOT_STALE)
  + instructions: open the connector admin page in WordPress and explicitly
  request a new diagnostic sync. No hidden remote sync command, ever.

## Deterministic rule engine (`lib/conflict/`, pure functions)
- Version comparator: parse numeric segments + pre-release suffixes
  (-beta/-rc/-alpha, etc.); invalid/malformed version → rule skipped with a
  reason, NEVER alphabetical compare.
- Rules A–H per brief. Finding fields: ruleId, category, severity, status
  (CONFIRMED_COMPATIBILITY | POTENTIAL | INSUFFICIENT_EVIDENCE — use this
  vocabulary consistently), title, description, evidence (declared vs
  observed), referencedItems, recommendation, confidence,
  requiredAdditionalEvidence.
- Hard invariants (unit-tested): two active plugins alone NEVER yield a
  confirmed conflict; post-update symptom NEVER proves causation; version
  mismatch = compatibility finding, NOT an invented crash; no logs → no
  log claim; no TLS data → no TLS finding; missing data stays missing.
- v1 snapshots: A/B/C/E cannot run (fields null) → a single
  INSUFFICIENT_EVIDENCE finding "extended snapshot required" + Rule D/H
  still apply; never fabricate the missing fields.

## Database (migration, dev + test DB, validate, generate)
- `ConflictDiagnostic`: id, userId FK cascade, websiteId FK cascade,
  snapshotPayload Json (bounded copy), snapshotSchemaVersion Int,
  snapshotReceivedAt DateTime, symptomCategory String (validated allowlist:
  UPDATE_ERROR, FRONTEND_BROKEN, ADMIN_ERROR, EDITOR_FAILURE,
  FEATURE_NOT_WORKING, THEME_LAYOUT, PHP_COMPAT_WARNING, OTHER, UNKNOWN),
  symptomDescription String ≤2000, errorExcerpt String? ≤2000 (redacted
  server-side for obvious secret patterns, untrusted, never logged, escaped
  on render), status COMPLETED | BLOCKED_SNAPSHOT | FAILED,
  createdAt, completedAt. Index [userId, createdAt], [websiteId].
- `ConflictFinding`: diagnosticId FK cascade, ruleId, category, severity,
  status, title, description, evidence Json, referencedItems Json,
  recommendation, confidence, requiredAdditionalEvidence. Index [diagnosticId].
- `ConflictAiAnalysis`: diagnosticId UNIQUE FK cascade, status, provider,
  model, schemaVersion ("conflict-1"), analysis Json?, errorCode?,
  createdAt, updatedAt, completedAt. Mirrors AiAnalysis safeguards; AI never
  touches ConflictDiagnostic/ConflictFinding rows.
- User model gains `conflictDiagnostics` relation; Website gains
  `conflictDiagnostics` relation.

## API (mirror /api/scans conventions)
- `POST /api/conflict-diagnostics` (body ≤10 KiB; only websiteId,
  symptomCategory, symptomDescription, errorExcerpt read; client snapshot /
  connectorId / ownerId ignored): session → ownership in WHERE → website
  CONNECTED + connection ACTIVE → latest snapshot → freshness/schema checks
  (BLOCKED_SNAPSHOT persisted? Decision: do NOT persist a diagnostic row for
  a blocked run — return 422 with status + re-sync instructions; persist
  only runs that actually analysed a snapshot, plus FAILED rows on engine
  errors) → run engine synchronously → persist diagnostic + findings → 201.
  Rate limit per-user in-memory (document single-process), 429 on exceed.
- `GET /api/conflict-diagnostics` (own only, desc, page/pageSize bounded),
  `GET /api/conflict-diagnostics/[id]` (ownership in WHERE, identical 404),
  `GET /api/conflict-diagnostics/snapshot?websiteId=` (own website only:
  versions, inventory, theme, update metadata, freshness, no secrets).
- `POST /api/conflict-diagnostics/[id]/ai-analysis` (explicit trigger only;
  input = sanitized inventory + deterministic findings + sanitized symptoms +
  clearly-labelled untrusted error text; never credentials/keys/logs;
  unknown/duplicate finding references reject the WHOLE analysis;
  503 AI_NOT_CONFIGURED when unconfigured; no mock content in production)
  + `GET` saved analysis.

## UI (mirror /tools/error-checker, Tailwind)
- `/tools/plugin-theme-checker` (select website w/ connection + freshness
  badge → symptom form w/ secret warning → review inputs w/ stale/missing
  warnings → explicit Run button, real loading state, duplicate-submit
  prevention, "the live site is not modified" notice → results: deterministic
  findings and AI interpretation in separate sections, severity/confidence/
  evidence/missing info/safe steps/risk notices), `/history`,
  `/[id]` detail. Dashboard SiteHeader link when signed in (mirror Error
  Checker). Escape all user/plugin content. No file uploads/screenshots.
- Safe next steps: staging testing, capturing error details, exact affected
  page/feature, PHP error evidence via hosting provider, expert investigation.
  Manual staging-isolation instructions may be DESCRIBED (with backup
  warning, labelled manual) — never executed by the app. No fabricated repair
  service entry point.

## Tests (execute; label honestly)
- Unit: `tests/conflict-rules.test.js` (all 16 brief cases + invariants),
  `tests/conflict-ai-validate.test.js` (mock provider cases).
- DB: extend `scripts/run-db-tests.mjs` (connector-style): migration,
  persistence, ownership scoping, snapshot-copy integrity, stale handling,
  AI storage, failure states, unauthorized access.
- API/E2E HTTP: `tests/e2e-conflict.test.js` (auth, ownership, snapshot
  states, oversized inputs, rate limit, duplicate-submit, AI 503 + mock).
- PHP: `tests/php-conflict.test.php` (php -l all changed files; v2 allowlist;
  no auto update-check — assert no `wp_update_plugins` call path; no log
  collection; pairing compatibility; manual-sync permission unchanged).
- Integration (real wp-dev): install v2 plugin, pair, sync, verify v2 payload
  stored + diagnostic runs against it; then restore wp-dev clean.
- Regression: lint, test, test:db, test:e2e, build. Browser E2E: NOT RUN.
