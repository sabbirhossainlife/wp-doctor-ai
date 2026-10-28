# Tool 02 — Plugin & Theme Conflict Checker (Milestone 6)

Deterministic, evidence-only conflict checking against the last
diagnostic snapshot a paired WordPress site sent. The app never
modifies a customer site: no remote deactivation/activation, no theme
switching, no settings/DB/file changes, no shell commands, no debug-log
enabling, no log collection, no staging isolation executed by the app.

## Snapshot versioning and backward compatibility

- **v1** (connector ≤ 1.0.0): `wordpressVersion`, `phpVersion`,
  `homeUrl`, `siteUrl`, `pluginVersion`, `activePlugins[{name,
  version}]`, `activeTheme[{name, version}]`, `multisite`, `locale`.
- **v2** (connector 1.1.0): everything in v1, plus `plugins[]` (ALL
  installed plugins from `get_plugins()` plus must-use plugins from
  `get_mu_plugins()`, each `{name, slug, version, active,
  networkActive, muPlugin, requiresWP, requiresPHP, dependencies[],
  updateAvailable, newVersion, updateCheckedAt}`) and `theme {name,
  version, parentName, parentVersion, requiresWP, requiresPHP}`.
- The server validator (`lib/connector/validate-snapshot.js`) accepts
  v1 AND v2 under a strict allowlist; anything else rejects the whole
  payload. Old plugins keep pairing and submitting; the engine
  degrades gracefully on v1 (see Rules).
- The `slug` field exists because Rule C needs it: declared
  dependencies are slugs (WP 6.5+ "Requires Plugins" header), and
  display names cannot be matched to slugs. Slugs are derived from
  plugin file paths on the site, never from user input.
- Header names verified against local WP 7.1.3 source:
  `wp-admin/includes/plugin.php` ("Requires at least", "Requires PHP",
  "Requires Plugins") and `wp-includes/class-wp-theme.php` ("Requires
  at least", "Requires PHP"; parent via `WP_Theme::parent()`).
- Collection rules (PHP collector, `includes/class-diagnostics.php`):
  active flags from the `active_plugins` option + `active_sitewide_plugins`
  (multisite) + `get_mu_plugins()`; dependencies ONLY from the
  "Requires Plugins" header — absent or unparseable → `[]`, never
  invented; update info ONLY from the cached `update_plugins` site
  transient (read-only) — the collector NEVER calls `wp_update_plugins()`
  or any refresh, so missing/stale update data is reported as
  unavailable/stale. No settings, user data, keys, config, order/customer
  data, post bodies, raw logs, or arbitrary options are collected.
- The connector admin page still requires `manage_options` and an
  explicit administrator action to send a snapshot. There is no
  background sync and no remote sync command.

## Freshness policy

- `CONFLICT_SNAPSHOT_MAX_AGE_MS`, default 24 h (86,400,000 ms),
  env-overridable. Older than the limit = `SNAPSHOT_STALE`.
- Missing / invalid / unsupported-schema / stale snapshots block the
  run: the API returns 422 with `snapshotStatus` (`SNAPSHOT_MISSING` |
  `SNAPSHOT_INVALID` | `SNAPSHOT_UNSUPPORTED` | `SNAPSHOT_STALE`) plus
  re-sync instructions: open the WP Doctor AI Connector admin page in
  WordPress and explicitly request a new diagnostic sync, then re-run.
  A diagnostic is never run on stale data presented as current, and a
  refresh is never claimed until a new valid snapshot is stored.
- Blocked runs persist NO diagnostic row (documented decision: history
  contains only runs that actually analysed a snapshot, plus FAILED
  rows on engine/persistence errors).

## Deterministic rules (`lib/conflict/`)

Pure functions over the snapshot + symptoms. No AI dependency. Finding
fields: `ruleId`, `category`, `severity`, `status`, `title`,
`description`, `evidence` (declared vs observed), `referencedItems`,
`recommendation`, `confidence`, `requiredAdditionalEvidence`. Status
vocabulary, used consistently: `CONFIRMED_COMPATIBILITY` | `POTENTIAL`
| `INSUFFICIENT_EVIDENCE`.

| Rule | What it checks |
| ---- | -------------- |
| A | Plugin PHP-minimum mismatch (declared `requiresPHP` vs site PHP). |
| B | Plugin WordPress-minimum mismatch (declared `requiresWP` vs site WP). |
| C | Declared dependencies: missing from inventory (confirmed) or installed but inactive (potential). Only runs when the dependency format is understood. |
| D | Active entry without matching inventory metadata; duplicate inventory slugs; missing version metadata. |
| E | Cached update available (potential notice only — never a vulnerability claim, never proof of a bug). |
| F | Theme compatibility (theme `requiresWP`/`requiresPHP` mismatches, reported here rather than duplicated under A/B) + parent-theme distinction (child theme parent reported, never blamed; parent version unknown → insufficient evidence). |
| G | Symptom/timing as user-reported context only. Never causal: a symptom after an update does not prove the update caused it. |
| H | Insufficient evidence: v1 extended-snapshot notice, missing requirement/update metadata, malformed-version skips. |

Version comparison (`lib/conflict/versions.js`): numeric segments +
pre-release suffixes (dev < alpha < beta < rc < release). Malformed
versions skip the affected rule with a recorded reason — never an
alphabetical compare ("10.0" ranks above "9.0").

Hard invariants (unit-tested): two active plugins alone NEVER yield a
confirmed conflict; post-update symptom NEVER proves causation; version
mismatch = compatibility finding, NOT an invented crash; no logs → no
log claim; no TLS data → no TLS finding; missing data stays missing.

v1 snapshots: A/B/C/E cannot run → a single INSUFFICIENT_EVIDENCE
"extended snapshot required" finding; D/H still apply. Never fabricate
the missing fields — upgrade the connector to 1.1.0+ and re-sync.

## Database

Migration: `prisma/migrations/20261027140056_init_m6_conflict/`
(applied to dev + test DBs; `prisma validate` + `prisma generate` run).

- `ConflictDiagnostic`: user/website FKs (cascade), `snapshotPayload`
  Json (bounded COPY of the analysed snapshot — never an FK to the live
  snapshot row, because the connector's latest-only model replaces that
  row on every sync), `snapshotSchemaVersion`,
  `snapshotReceivedAt`, `symptomCategory` (allowlist: UPDATE_ERROR,
  FRONTEND_BROKEN, ADMIN_ERROR, EDITOR_FAILURE, FEATURE_NOT_WORKING,
  THEME_LAYOUT, PHP_COMPAT_WARNING, OTHER, UNKNOWN),
  `symptomDescription` ≤ 2000, `errorExcerpt` optional ≤ 2000
  (server-side redacted for obvious secret patterns, untrusted, never
  logged), `status` COMPLETED | BLOCKED_SNAPSHOT | FAILED.
  Indexes: `[userId, createdAt]`, `[websiteId]`.
- `ConflictFinding`: diagnostic FK (cascade), rule/category/severity/
  status/title/description/evidence Json/referencedItems Json/
  recommendation/confidence/requiredAdditionalEvidence.
  Index: `[diagnosticId]`.
- `ConflictAiAnalysis`: diagnostic UNIQUE FK (cascade), status,
  provider, model, `schemaVersion` "conflict-1", `analysis` Json?,
  `errorCode`?. AI never touches diagnostic/finding rows.

## API routes

All routes mirror `/api/scans` conventions: session via
`lib/session.js`, ownership in WHERE, identical 404s, 10 KiB body
limit, sanitized errors, no logging of symptom/error text.

- `POST /api/conflict-diagnostics` — reads ONLY `websiteId`,
  `symptomCategory`, `symptomDescription`, `errorExcerpt`; any client
  snapshot/connectorId/ownerId is ignored. Flow: session → ownership →
  CONNECTED + ACTIVE → latest snapshot → freshness/schema gates (422
  on block, nothing persisted) → engine synchronously → persist
  diagnostic + findings → 201. Per-user in-memory rate limit
  (20/hour, `lib/conflict/rate-limit.js`, documented single-process;
  429 on exceed). Blocked snapshot runs count as attempts.
- `GET /api/conflict-diagnostics` — own only, newest first, bounded
  paging (`page`/`pageSize`, max 100).
- `GET /api/conflict-diagnostics/[id]` — ownership in WHERE.
- `GET /api/conflict-diagnostics/snapshot?websiteId=` — own website
  only: versions, inventory, theme, update metadata, freshness. No
  URLs, credentials, or secrets.
- `POST /api/conflict-diagnostics/[id]/ai-analysis` — explicit user
  trigger only. Input = sanitized inventory + deterministic findings +
  sanitized symptoms + clearly-labelled untrusted error text ONLY
  (never credentials/keys/logs). Output validated against real finding
  IDs: unknown/duplicate references reject the WHOLE analysis. AI
  never overwrites deterministic findings. Unconfigured → 503
  `AI_NOT_CONFIGURED`. No mock content in production.
- `GET /api/conflict-diagnostics/[id]/ai-analysis` — saved analysis.

## AI behavior

- Reuses the Milestone 4 provider adapter (`OpenAiProvider`,
  `getAiConfig`, shared rate limiter) with a conflict-specific prompt,
  input builder, and validator (`lib/conflict/ai-*.js`). The scan
  schema/validation is untouched; conflict output uses schemaVersion
  "conflict-1". The only change to shared AI code is an optional
  `messagesBuilder` parameter on the providers (default = scan prompt),
  so Tool 02 can inject its own system prompt without altering scan
  behavior.
- Claim guardrails (heuristic, same philosophy as Milestone 4): TLS
  validity claims, named plugin/theme as confirmed cause, confirmed
  conflict claims, and dangerous live-site actions (including
  deactivating plugins or switching themes on the live site) all reject
  the whole analysis. The UI labels AI output as interpretation.
- AI config status: NO key is configured in this deployment
  (`.env.local` has no AI vars), so production AI interpretation
  returns 503 `AI_NOT_CONFIGURED` honestly; the deterministic report is
  complete on its own. This was verified by the AI E2E test's
  not-configured path and by the conflict AI unit tests.

## UI

- `/tools/plugin-theme-checker`: Step 1 own websites only with
  connection + freshness badge; Step 2 snapshot review (with
  stale/missing warnings); Step 3 symptom form with secret warning;
  Step 4 explicit Run button, real loading state, duplicate-submit
  prevention, "the live site is not modified" notice; Step 5 results
  (detail page) with deterministic findings and AI interpretation in
  SEPARATE sections, severity/confidence/evidence/missing info/safe
  steps/risk notices; Step 6 safe next actions only — no fabricated
  repair service. No file uploads/screenshots. All user/plugin content
  is rendered through React (escaped).
- `/tools/plugin-theme-checker/history`, `/tools/plugin-theme-checker/[id]`.
- Dashboard header links "Plugin & Theme Checker" when signed in
  (mirrors the Error Checker link).
- Safe next steps may DESCRIBE manual staging isolation (with backup
  warning, labelled manual) — never executed by the app.

## Limitations

- The engine can only see what the snapshot contains: header
  requirements, dependency headers, cached update data. It cannot see
  runtime errors, logs, database state, or actual plugin interactions,
  so it cannot confirm any root cause. A clean deterministic report is
  "no mismatch found in the snapshot", not "no conflict exists".
- Dependency matching needs slugs: a plugin whose "Requires Plugins"
  header lists a slug that no installed plugin file maps to is reported
  missing, even if an equivalent plugin is installed under another slug.
- Update data is only as fresh as WordPress's last cached update
  check; the app never triggers a refresh.
- Rate limits (diagnostic + AI) are in-memory and single-process only;
  a multi-instance deployment needs a shared store behind the same
  interfaces.
- Browser E2E is NOT RUN (no browser binary in this VM). UI coverage
  is HTTP-level (page renders, history/detail states, unauthorized
  access) plus the component-level guarantees above.
- Production SaaS domain is still unconfirmed: the connector plugin's
  API base must be supplied via the `WP_DOCTOR_AI_API_BASE_URL`
  wp-config constant at deployment (see `docs/connector.md`).

## Deployment requirements

- Apply migration `20261027140056_init_m6_conflict` (dev + test DBs
  already migrated in this workspace; production must run `migrate
  deploy`).
- Set `CONFLICT_SNAPSHOT_MAX_AGE_MS` only if a non-24 h freshness
  window is wanted; otherwise the default applies.
- AI remains optional: without `AI_PROVIDER=openai`,
  `OPENAI_API_KEY`, and `OPENAI_MODEL`, AI interpretation returns 503
  and everything else works.
- Ship connector plugin 1.1.0 to sites that need full checks; v1
  plugin sites keep working with degraded rules.
