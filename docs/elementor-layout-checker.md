# Tool 04 — Elementor & Layout Checker (Milestone 8)

Diagnostic/advisory only. Read-only. No repairs, no remote control, no
plugin deactivation, no theme switching, no page rendering, no screenshot
or image analysis, no browser console inspection.

## What it checks

From the latest connector snapshot (schema v4) plus user-reported symptoms,
the deterministic engine (`lib/elementor/engine.js`) reports:

- **A — Elementor presence:** NOT_INSTALLED / INACTIVE from explicit v4
  state only. A legacy (v1–v3) snapshot without Elementor data is reported
  as INSUFFICIENT_EVIDENCE, never as "Elementor missing".
- **B — Elementor Pro status:** version information only. Free + Pro both
  installed and active is NOT a conflict (no finding). Pro installed but
  inactive, Pro active without Free available, and Pro version unavailable
  each get a careful non-conflict finding. No Elementor↔Pro version-pair
  rule is encoded: no trustworthy pair table was verified.
- **C — Declared requirements:** each Elementor Free/Pro plugin header's
  `RequiresWP` / `RequiresPHP` against the site's WordPress/PHP versions
  (real version comparator from Tool 02). A mismatch is a POTENTIAL
  warning, never a confirmed crash. Malformed versions are skipped and
  recorded, never approximated.
- **D — Memory warning band:** effective configured limit =
  `wpMemoryLimit` if present, else `phpMemoryLimit`. Below 256 MB is a
  POTENTIAL warning; at/above, or unlimited (`-1`), is no finding.
  A configured limit is NOT observed memory usage, and this finding does
  NOT prove memory exhaustion.
- **E — Editor/preview symptom context:** the reported symptom is
  user-reported context only. Related config evidence may be related, never
  a proven cause. Post-update timing is not causation. Safe Mode is
  described only as an editor troubleshooting mechanism (editor session,
  signed-in administrator only), never as a guaranteed or universal fix,
  and never as a fix for live-page layout.
- **F — URL configuration:** protocol + hostname of home vs site URLs
  only. A subdirectory path difference is LEGITIMATE and never a finding.
  Exact observed values are in the evidence.
- **G — Conflict candidates:** other active non-Elementor plugins are
  CANDIDATES only (the Tool 02 concept, without duplicating or
  contradicting Tool 02's rules). No conflict is established, no isolation
  was performed, nothing was deactivated, no theme was switched.
- **H — JS/CSS errors:** no browser console data exists in this milestone,
  so there is never an independently verified console finding. A user
  excerpt is untrusted context only: its text is never embedded in a
  finding and never logged.
- **I — Frontend layout:** configuration checks cannot prove visual
  correctness. No rendering or visual test exists, no HTTP status is
  treated as proof of correct layout, and no screenshot is analysed.
  Visual condition is explicitly UNVERIFIED for frontend/both-scope
  symptoms.
- **J — Insufficient evidence:** legacy snapshot, UNKNOWN status, missing
  version metadata, missing/unparseable memory, malformed-version skips,
  missing plugin inventory — each states what is missing and how to obtain
  it safely, plus an expert recommendation.

Finding status vocabulary (same literals as Tools 02/03):
CONFIRMED_COMPATIBILITY | POTENTIAL | INSUFFICIENT_EVIDENCE. Every
finding carries ruleId, category, severity, status, title, description,
evidence (real snapshot fields), referencedItems, recommendation,
confidence, and requiredAdditionalEvidence.

## Documented sources (checked 2026-10-27, public docs text only)

- Elementor Help, "How to Fix the 'Preview Could Not Be Loaded' Error"
  and "What is Safe Mode And How to Use It?" (elementor.com/help): Safe
  Mode loads the editor without active theme styles / third-party plugin
  scripts for the signed-in administrator only; live visitors see no
  change. If the editor loads in Safe Mode, a plugin/theme conflict is
  indicated; if it still fails, server configuration / memory / permalink
  causes are indicated. Safe Mode is editor-only: it does not fix
  live-page layout or widget-panel loading.
- Elementor Help, "Safe Mode Activation Isn't Solving My Problem"
  (elementor.com/help): when Safe Mode does not resolve loading, check
  the WP memory limit (256M or 512M in wp-config.php), matching Site and
  WordPress URLs under General Settings, the Switch Editor Loader Method
  setting, and browser console / security-header / caching blocks.
- Elementor system requirements, as quoted by secondary sources reporting
  Elementor's published requirements on/around 2026-10-21: WordPress
  6.5–6.8 or greater (sources differ by snapshot date; latest
  recommended), PHP 7.4 minimum with PHP 8.3+ highly recommended, WP
  memory limit 256 MB for Elementor/Pro, 512 MB recommended, 768 MB for
  best performance. Because sources differ and no single official
  requirements page URL was returned by search at implementation time,
  the engine does NOT hardcode a WP/PHP version cutoff from docs: Rule C
  uses the installed plugin's own declared headers, and Rule D uses
  256 MB ONLY as a warning band. Supported version range for
  version-specific rules: whatever the installed Elementor plugin's own
  headers declare.
- No trustworthy source was found for a precise max_execution_time
  requirement, an Elementor↔Pro version-pair matrix, or a console-error
  taxonomy; no rule encodes those. `maxExecutionTime` is collected as
  evidence only, with no threshold finding.

## Snapshot v4 + backward compatibility

Connector plugin 1.2.0 → **1.3.0**, snapshot **schemaVersion 4**.
Validator (`lib/connector/validate-snapshot.js`) accepts 1, 2, 3, AND 4;
v1–v3 payloads keep validating exactly as before.

v4 = all v3 fields PLUS `elementor` and `environment` (both required for
v4, exact-key objects):

- `elementor`: `{ installed, active, version, pro: { installed, active,
  version }, status: AVAILABLE|NOT_INSTALLED|INACTIVE|UNKNOWN }`.
  Derived ONLY from the existing `plugins[]` inventory: Free matches slug
  `elementor` OR display name "Elementor" (case-insensitive); Pro matches
  slug `elementor-pro` OR name "Elementor Pro". Slug/filename alone is
  never the sole signal, and Pro is never assumed from Free being active.
  If `get_plugins()` is unavailable the status is UNKNOWN; if it ran and
  no entry matches, NOT_INSTALLED. Missing Pro version is null (UNKNOWN).
  No inventory fields are duplicated.
- `environment`: `{ phpMemoryLimit, wpMemoryLimit, maxExecutionTime }`,
  each a string from `ini_get('memory_limit')` / `WP_MEMORY_LIMIT` when
  defined / `ini_get('max_execution_time')`, or null when unavailable.
  These are CONFIGURED values, documented as NOT observed runtime
  availability.

Freshness: same 24 h policy as Tools 02/03 (own env var
`ELEMENTOR_SNAPSHOT_MAX_AGE_MS`). Missing / invalid / unsupported / stale
snapshots return 422 with re-sync instructions (open the connector admin
page in WordPress and explicitly request a sync); NO diagnostic row is
persisted for a blocked run, and no refresh is ever claimed until a new
valid snapshot is stored.

Never collected: passwords, cookies, keys, connector credentials, DB
credentials, full wp-config, arbitrary options, post bodies, full page
HTML, raw/PHP logs, user info, order data, env vars, screenshots, console
output. URL analysis reuses snapshot `homeUrl`/`siteUrl` — no duplication.

## API routes

- `POST /api/elementor-diagnostics` — websiteId + symptom fields only
  (symptomCategory, symptomDescription, affectedScope, affectedPages,
  deviceScope, updatePreceded, startedAt, errorExcerpt). Client snapshots,
  inventory, connector IDs, and ownership fields are ignored. Ownership
  in WHERE; identical 404 for nonexistent vs another user's website;
  10 KiB body cap; in-memory rate limit 20/hour/user (single-process,
  documented limitation); 422 for missing/stale/invalid snapshot.
- `GET /api/elementor-diagnostics` — own diagnostics only, newest first,
  bounded paging (page/pageSize, max 100).
- `GET /api/elementor-diagnostics/[id]` — ownership in WHERE, else 404.
- `GET /api/elementor-diagnostics/snapshot?websiteId=…` — snapshot view
  for the tool UI (own website only, no secrets).
- `POST/GET /api/elementor-diagnostics/[id]/ai-analysis` — explicit user
  trigger only.

Symptom categories (15): ELEMENTOR_EDITOR_NOT_LOADING,
ELEMENTOR_EDITOR_WHITE_SCREEN, ELEMENTOR_EDITOR_GRAY_SCREEN,
ELEMENTOR_EDITOR_STUCK_LOADING, ELEMENTOR_PREVIEW_NOT_LOADING,
ELEMENTOR_WIDGET_PANEL_NOT_LOADING, ELEMENTOR_JAVASCRIPT_ERROR,
ELEMENTOR_CSS_OR_ASSET_ISSUE, FRONTEND_LAYOUT_BROKEN, MOBILE_LAYOUT_ISSUE,
ELEMENTOR_FREE_PRO_COMPATIBILITY, PHP_OR_ENVIRONMENT_REQUIREMENT,
WORDPRESS_URL_CONFIGURATION, ISSUE_AFTER_UPDATE, OTHER_OR_UNKNOWN.
affectedScope: editor/frontend/both/unknown; affectedPages:
one/many/unknown; deviceScope: mobile/desktop/both/unknown;
updatePreceded: TRUE/FALSE/UNKNOWN (null input = UNKNOWN).
symptomDescription ≤ 2000 chars, errorExcerpt ≤ 2000 chars (server-side
redacted for obvious secret patterns, never logged).

## AI behaviour

Reuses the M4 provider adapter (OpenAI Chat Completions, strict
json_schema, model ONLY from env `OPENAI_MODEL`). AI input
(`lib/elementor/ai-input.js`) = verified findings + Elementor/Pro
status/versions + theme name/version + other active plugin NAMES only +
environment limits + validated symptom + sanitized excerpt (labelled
untrusted) + missing-evidence indicators ONLY. Never sent: credentials,
tokens, passwords, cookies, keys, logs, HTML, personal data, arbitrary
config, site URLs, user ids, emails, or raw snapshot internals.

The validator (`lib/elementor/ai-validate.js`, schemaVersion
"elementor-1") rejects the WHOLE analysis on: unknown or duplicate
finding refs, invented JS/CSS/console claims, invented visual
verification, rendering-test claims, screenshot claims, Safe-Mode-fixed
or Safe-Mode-guarantee claims, confirmed memory-exhaustion claims,
named-plugin confirmed-cause claims, confirmed-cause claims in general,
update-caused claims, and unsafe recommendations (permanent security
plugin deactivation, deleting unknown files, overwriting production
databases, unreviewed commands, live-site deactivation/theme switching).
AI never overwrites deterministic findings. When AI is unconfigured,
production returns **503 AI_NOT_CONFIGURED** honestly and the
deterministic report stands alone; no mock AI content is used in
production routes. At implementation time `.env.local` has no AI vars, so
production AI is confirmed NOT_CONFIGURED.

## UI

- `/tools/elementor-layout-checker` — website select (own only),
  connector status + freshness + Elementor/Pro status where known
  (unknown is never labelled inactive), sync-needed guidance, symptom
  form (category, when began, editor vs frontend, one vs many pages,
  mobile/desktop/both, update preceded, optional redacted excerpt with
  secret warning), real loading state, validation, stale/missing errors,
  rate-limit handling, completion, duplicate-submit prevention.
- `/tools/elementor-layout-checker/[id]` — report: overall outcome,
  confirmed findings, potential causes, evidence, severity, qualitative
  confidence, user-reported context, missing evidence, safe manual next
  steps (System Info review, Free/Pro compat per official docs,
  error-message review, Tool 02 findings review, memory config review,
  hosting-provider server-error review, editor-vs-frontend scope, Safe
  Mode as an editor troubleshooting mechanism NOT a universal fix,
  official docs, staging before disruptive changes — with backup/staging/
  risk notes where a step touches production, performed only by an
  authorized admin, never executed by the app), risks/limitations, AI
  status, expert recommendation. Technical config findings are clearly
  separated from visual-layout symptoms.
- `/tools/elementor-layout-checker/history` — own reports only, bounded
  paging, report + snapshot timestamps shown.
- All user/plugin-supplied content is escaped by React. No screenshot
  upload is offered: the UI copy states explicitly that visual diagnosis
  is based on user-reported symptoms + technical evidence, not image
  analysis. No fake progress percentages, no fabricated health scores, no
  visual-verification claims. Header link added ("Elementor Checker");
  no unrelated dashboard pages were redesigned.

## Privacy / safety safeguards

- Read-only, advisory only. The app never deactivates a plugin, switches
  a theme, edits a file, runs a remote command, or changes a live setting.
- Recommendations use official Elementor docs guidance only (cited
  above). Never instruct permanent security-plugin deactivation, deleting
  unknown files, overwriting production databases, or running unreviewed
  commands.
- Diagnostics store a BOUNDED COPY of the snapshot payload, never an FK
  to the live latest-only row, so a later sync cannot falsify old reports.
- Error excerpts are user-supplied and untrusted; obvious secret patterns
  are redacted server-side before storage and excerpts are never logged.
  Embedded instructions in excerpts are ignored (treated as data).

## Screenshot deferral + visual-unverified statement

No file/screenshot upload system was built in this milestone (none was
verified to exist in the codebase). Visual diagnosis in Tool 04 is
symptom + technical evidence only: the user describes what they see, the
engine checks configuration, and the report states plainly that the
visual condition is UNVERIFIED. A future milestone could add a human
visual-review workflow; it must not claim automated image analysis unless
such a capability is actually built and verified.

## Versions / configurations actually tested

- Unit: Node test runner, 278 tests total (see `npm test` output).
- PHP: standalone stub tests (no phpunit binary in VM):
  `tests/php-elementor.test.php` 16/16, plus M5/M6/M7 PHP suites
  (connector 40/40, conflict 22/22, WooCommerce 13/13, no-WC 9/9,
  devmode 5/5) after updating their schema assertions for the intentional
  v4 change only (exact allowlist keys + schema version).
- DB: dev + test PostgreSQL 16 (recreated after a VM replacement wiped
  the cluster binaries; see report for the recovery steps).
- wp-dev integration: WordPress 7.1.3, PHP 8.3.6, WooCommerce 11.2.1,
  Elementor **4.3.5** (header: Requires PHP 7.4, Requires at least 6.8),
  active theme Oishi, active plugins Contact Form 7 / Elementor /
  Mivloo Core / WooCommerce / Yoast SEO, home = site =
  http://127.0.0.1:8080 (matching protocol/hostname, no subdirectory).
  The v4 collector was verified via the stub suite and via the live
  inventory values above; a full pair→sync→diagnostic round trip through
  the SaaS dev server was NOT completed in this milestone (see
  limitations in the final report) and is not claimed.
- Browser E2E: NOT RUN — no browser binary in this VM. HTTP-level E2E
  tests cover the API and tool pages instead.

## Limitations

- No browser console data, no rendering/visual test, no screenshot
  analysis, no plugin isolation, no theme switching, no server-log
  access. Any of those require a human with admin/hosting access.
- In-memory rate limiters (diagnostic + AI) are single-process only; a
  shared store is the production replacement (same limitation as
  Tools 02/03).
- Elementor requirements quoted from secondary sources differ by
  snapshot date (WP 6.5 vs 6.8); the engine avoids depending on either by
  using plugin-declared headers. Re-check Elementor's official
  requirements before changing the 256 MB warning band or adding any
  version cutoff.
- Production SaaS domain is still unconfirmed (must be supplied via
  wp-config, as in M5–M7). Deployment requirements are otherwise the same
  as Milestones 0–7: Next.js + PostgreSQL + Prisma, `OPENAI_MODEL` /
  `OPENAI_API_KEY` only if AI interpretation is wanted.

## Files

- `lib/elementor/{engine,freshness,rate-limit,service,ai-input,ai-prompt,ai-validate,ai}.js`
- `app/api/elementor-diagnostics/{route,[id]/route,snapshot/route,[id]/ai-analysis/route.js}`
- `app/tools/elementor-layout-checker/{page,[id]/page,history/page}.jsx`
- `components/{ElementorCheckerForm,ElementorAiSection}.jsx`
- `prisma/schema.prisma` + migration `20261027151051_init_m8_elementor`
  
- `wordpress-plugin/wp-doctor-ai-connector/` (v1.3.0, schema v4)
- `tests/{elementor-rules,elementor-invariants,elementor-ai-validate,elementor-db,e2e-elementor}.test.js`, `tests/php-elementor.test.php`
