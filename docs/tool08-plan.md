# Tool 08 — Security & Vulnerability Scanner: Implementation Plan (Milestone 12)

## Provider choice (researched 2026-10-28, before implementing)

- **Active provider: WPVulnerability** (`https://www.wpvulnerability.net`,
  fixed host, no user-supplied base URL, no API key for the core/plugin/theme
  endpoints). Verified live from this VM (no key): `GET /plugin/akismet/`
  returned `error: 0` with advisories carrying `operator`
  `{min_version, min_operator, max_version, max_operator, unfixed, closed}`
  and `source[]` CVE/WPScan links; `GET /core/5.8.2/` returned
  version-specific advisories; an unknown slug returned `error: 0` with
  `vulnerability: null`. The project describes itself as a "100% open and
  free API"; its licensing page asks users to link to WPVulnerability and/or
  the source (requested, not a hard redistribution ban) and notes EUPL v1.2
  work. No published rate limit was found in the docs, so this tool imposes
  its own bounds (see below) and never relies on an unpublished limit.
- **WPScan: NOT implemented as the active provider.** Its API requires a
  token on every request, its free tier is non-commercial only (25/day in
  current third-party summaries), and commercial SaaS use requires a paid
  Enterprise/commercial licence. No token or licence exists for this project,
  so WPScan is documented as not-configured/unsupported, never silently
  substituted. The adapter interface keeps providers replaceable if a
  commercial licence is ever obtained.
- **Storage/caching policy:** only minimal advisory references are stored
  (advisory uuid, title, affected range in provider representation, fixed
  version only where the provider semantics support it, CVSS score/severity
  only when supplied, source ids/links/dates only when supplied, retrieval
  timestamp, attribution to WPVulnerability). Full provider responses are
  never stored or redistributed. Reports show attribution + retrieval time.
- **Env config (server-only, no key):** `VULNERABILITY_PROVIDER`
  (default `wpvulnerability`; `none` = explicitly off; any other value =
  unsupported -> PROVIDER_UNAVAILABLE), `VULNERABILITY_PROVIDER_TIMEOUT_MS`
  (default 8000), `VULNERABILITY_MAX_COMPONENTS` (default 60),
  `VULNERABILITY_PROVIDER_CONCURRENCY` (default 2),
  `VULNERABILITY_MAX_RESPONSE_BYTES` (default 512 KiB). No key env var
  exists for the active provider; none is ever logged or returned.

## Connector v6 (plugin 1.4.0 -> 1.5.0)

- New section only: `securityIndicators {wpDebug, wpDebugDisplay,
  wpDebugLog, disallowFileEdit}` each `yes|no|unknown`, collected ONLY from
  runtime constants via `defined()` (`WP_DEBUG`, `WP_DEBUG_DISPLAY`,
  `WP_DEBUG_LOG`, `DISALLOW_FILE_EDIT`). Never wp-config.php contents,
  never arbitrary options. Validator accepts v1-v6; v1-v5 validate exactly
  as before and simply lack indicators (hardening checks then report
  insufficient evidence, never a false positive). Theme slug is NOT added
  (out of the "only securityIndicators" scope): the v2-v6 theme object has
  no slug, so theme advisories cannot be matched by canonical slug and are
  reported COMPONENT_IDENTITY_UNCERTAIN / INSUFFICIENT_EVIDENCE, never
  matched by display name.
- Pairing/auth/timestamp/replay/size/identity/revocation unchanged;
  sync remains admin-triggered only.

## Version matching (lib/security/)

- Reuses `lib/conflict/versions.js` `compareVersions` for standard versions
  only. A version is "standard" iff it matches `v?\d+(\.\d+)*` exactly;
  anything else (prerelease `1.0-beta1`, dev, `unknown`, nonstandard) ->
  COMPONENT_VERSION_UNKNOWN, never matched and never cleared.
- Supported provider range representations (WPVulnerability plugin/theme
  `operator`): `min_version`/`min_operator` in {gt, ge} and
  `max_version`/`max_operator` in {lt, le, eq}; either bound may be null
  (open-ended). `unfixed: "1"` means no fixed version (fixedVersion null,
  still a match if in range). Any other operator, unparseable bound, or
  nonstandard installed version -> INSUFFICIENT_EVIDENCE for that advisory.
- `fixedVersion` derivation: only when `max_operator` is `lt` (first fixed
  version = max_version). For `le` the fixed version is unknown (it is
  strictly above max_version) and is NOT fabricated. Core: the core
  endpoint is version-specific, so a non-empty advisory list for the exact
  installed core version is a match; an empty list is
  NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES only.
- Status vocabulary: MATCHED_ADVISORY, OUTDATED_NO_MATCHING_ADVISORY,
  NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES, COMPONENT_VERSION_UNKNOWN,
  COMPONENT_IDENTITY_UNCERTAIN, PROVIDER_UNAVAILABLE, PROVIDER_RATE_LIMITED,
  PROVIDER_ERROR, INSUFFICIENT_EVIDENCE.

## Passive HTTP checks (through M2 pinned components only)

- Implemented in `lib/security/http.js` reusing `parseScanTarget`,
  `resolveAndValidate` (DNS + IP policy) and `pinnedRequest` (pinned
  transport). No second network stack, no unrestricted fetch for site
  probing. Redirects: same-host only, max 3, else that check stops with a
  redirect note. Per-scan HTTP request cap 30 (6 sensitive paths + homepage
  + xmlrpc + redirects).
- Transport extension (option (a), bounded): `pinnedRequest` gains an
  opt-in `captureBodyBytes` (default off, M2 behaviour unchanged). Only the
  sensitive-path probes set it (4 KiB). The service classifies the captured
  bytes immediately against per-path signatures, then discards them;
  persisted data is ONLY a sanitized classification (path, status, result,
  content-type category) — never body text, never secrets.
- Sensitive paths (fixed list, no crawling/enumeration): `/.env`,
  `/.git/HEAD`, `/wp-config.php.bak`, `/wp-config.php~`,
  `/wp-content/debug.log`, `/debug.log`. Classification: 200 + per-path
  signature -> SENSITIVE_FILE_EXPOSURE_CONFIRMED; 200 without signature ->
  SENSITIVE_FILE_POSSIBLE_EXPOSURE; non-200 -> not observed (with the
  limitation that 403/404 alone do not prove absence). Secret-resembling
  bodies are never persisted; a probe that looks secret-bearing stops
  reading and discards the body.
- Headers (homepage response): Strict-Transport-Security,
  Content-Security-Policy, X-Content-Type-Options, X-Frame-Options or
  effective CSP frame-ancestors, Referrer-Policy, Permissions-Policy.
  Missing -> SECURITY_HEADER_MISSING; weak only for narrow rules (HSTS
  max-age < 31536000; X-Content-Type-Options != nosniff; X-Frame-Options
  not DENY/SAMEORIGIN; CSP wildcard or unsafe-inline) — a policy differing
  from one preferred template is NOT automatically invalid. Unobservable ->
  SECURITY_CHECK_NOT_RUN. No new TLS certificate findings (Tool 06 owns
  those).
- XML-RPC: unauthenticated GET observation only, no method calls/auth/
  payloads. 200/405 -> XMLRPC_ENDPOINT_RESPONDS (informational; disabling
  is NOT auto-recommended — legitimate integrations exist). Other
  statuses/probe failure -> not observed / not run.
- Update status from snapshot cached metadata only (plugin
  updateAvailable/newVersion): COMPONENT_OUTDATED. Outdated != vulnerable.
  No auto-install, no update calls.

## Scope, DB, API, UI

- Full scans require an owned registered website + fresh (24 h) snapshot;
  stale/missing/invalid -> 422, no row persisted. NO URL-only full
  vulnerability scan: client URL/inventory/versions/findings are ignored
  or rejected; server snapshot is the only source of truth. No
  unauthenticated endpoints. Provider failure -> PARTIAL report with
  explicit provider limitation, never a clean scan.
- Prisma migration after `20261028001000_init_m11_contact_email`:
  `SecurityDiagnostic` (+ `SecurityDiagnosticFinding` with advisory fields
  + `SecurityAiAnalysis` 1:1, regeneration overwrites). Historical reports
  immutable; bounded pagination.
- API mirrors Tools 02-07: POST /api/security-diagnostics, GET list,
  GET /[id], POST/GET /[id]/ai-analysis (M4 adapter, explicit trigger,
  sanitized bounded evidence only, refs validated against stored finding
  ids, deterministic results never altered, 503 AI_NOT_CONFIGURED when
  unconfigured).
- UI mirrors Tools 02-07: /tools/security-scanner (+ history + detail),
  result categories visually separated (advisory match / outdated /
  hardening / possible exposure / no matching advisory in checked sources
  / not checked / provider unavailable), never a "100% Secure" badge.
  Header navigation link added per existing conventions.

## Tests (honest labelling)

- Unit: version/range boundaries, provider parsing (fixtures + doubles:
  success/empty/unknown-slug/auth failure/rate limit/timeout/malformed/
  outage/schema change/size cap/no-call-when-unconfigured/arbitrary-URL
  rejection), connector v6 + v1-v5 regression, header rules, sensitive-path
  classification + secret sanitization, rules engine, AI validation.
- DB: ownership, cross-user denial, stale blocking, partial-on-provider-
  failure, client-override rejection, AI cannot alter deterministic rows.
- Integration: controlled local HTTP servers via injected httpProbe
  (headers present/missing/ambiguous, redirects, 404, 200-without-signature,
  signature-recognised without persisting contents, cross-host redirect
  not followed, private-destination rejection via real pinned path in
  scanner regression tests).
- Regression: npm run lint, npm test, npm run test:db, npm run test:e2e,
  npm run build, scanner suite, PHP `php -l` + stub tests.
- NOT RUN: browser E2E (no browser binary in VM) — documented, not faked.
  Live provider: 2 keyless read-only GETs actually ran (akismet, core
  5.8.2, unknown slug) to verify schema; no live scan of a real site is
  claimed. No exploit, login, form-submit, upload, or mutation was
  attempted anywhere.
