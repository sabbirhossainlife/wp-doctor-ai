# Tool 09 — Malware & Hack Recovery: implementation plan (Milestone 13)

Read-only, authenticated, defensive diagnostics. No cleanup, quarantine,
restore, delete, edit, permission-change, settings-change, credential-change,
form-submit, or any other site-modifying action exists anywhere in this tool.
Recovery guidance is human-operator recommendations only.

## 1. Scan-execution model (stated honestly in plan, UI, and docs)

- The connector sync is user-triggered from the WordPress admin ("Send
  diagnostic snapshot"). There is no remote-triggered scan and no SaaS-side
  file-tree access.
- Local file inspection runs inside the connector at sync time
  (admin-triggered, bounded). The SaaS diagnostic analyses the stored
  snapshot's genuine connector-side scan evidence and states its timestamp
  and coverage.
- If the required connector-side malware scan has not run, the API/UI say so
  (executionStatus NOT_RUN, finding MALWARE_CHECK_NOT_RUN) and ask the user
  to synchronise via the existing authenticated WP admin workflow. The SaaS
  NEVER simulates a new scan from an old snapshot, NEVER fabricates live
  progress, and NEVER re-scans the file tree on browser refresh.
- The SaaS engine receives NO raw source-code bodies, NO matched source
  lines, NO secrets, NO absolute server paths — only sanitized summaries,
  counts, relative paths, rule/checksum IDs, and evidence categories.

## 2. Checksum sources — what was actually verified (2026-10-28)

Verified by live text fetch (not assumed):
- Core: `GET https://api.wordpress.org/core/checksums/1.0/?version=<version>&locale=<locale>`
  returns JSON `{"checksums": {"<relative-path>": "<md5-hex32>", ...}}`.
  Without version/locale it returns `{"checksums":[]}`. Paths are relative
  to the WP root and include root files, wp-admin, wp-includes, and the
  bundled default themes shipped with that release. Only the installed WP
  version + locale from the snapshot are requested; nothing else is sent.
- Plugin: WP-CLI's own `WpOrgApi::get_plugin_checksums()` source (used by
  `wp plugin verify-checksums`) builds
  `https://downloads.wordpress.org/plugin-checksums/{slug}/{version}.json`
  and requires a `files` object mapping relative path -> checksum record
  (md5/sha256). The live plugin JSON body was NOT fetched in this session,
  so the connector validates the shape strictly (plugin + version echo must
  match the requested slug + version, files must be an object of records
  with a hex md5 or sha256) and treats any other shape as
  CHECKSUM_REFERENCE_UNSUPPORTED — never as a clean result.
- Theme checksums: NO trustworthy theme checksum endpoint was verified in
  this session, so theme checksum verification is NOT implemented. The
  snapshot theme object gains a genuinely reliable `slug` (the active
  theme's stylesheet directory name via `wp_get_theme()->get_stylesheet()`,
  a trusted runtime source — display-name matching remains forbidden), but
  theme checksum status is always CHECKSUM_REFERENCE_UNSUPPORTED. The code
  THEME_CHECKSUM_MISMATCH is therefore NOT emitted by this milestone.
- Terms: WordPress.org privacy/terms apply to these requests; only version,
  locale, plugin slug, and plugin version are sent. No site data, file
  contents, or scan results are transmitted to WordPress.org.
- Live-fetch constraints (connector-side only): fixed official WordPress.org
  hosts/paths only, HTTPS with normal certificate validation (sslverify
  true, never a TLS bypass), no redirect following (redirection 0; a
  redirect response is a provider failure, never followed to an arbitrary
  host), 5 s timeout per request, response-size caps (4 MiB core, 2 MiB
  per plugin), parsed as data only (never executed), no user-controlled
  provider URLs, no silent fallback to an unverified source. If the service
  is unavailable/disabled/malformed/incompatible -> incomplete verification,
  NEVER a clean claim. Comparison itself is local: file contents and hashes
  beyond bounded summaries are never sent to the SaaS.

## 3. Connector snapshot v7 (plugin 1.5.0 -> 1.6.0)

- Validator accepts v1-v7; v1-v6 validate exactly as before. Theme object
  gains an OPTIONAL `slug` key in v7 only (stylesheet directory name);
  v1-v6 theme payloads with a slug still reject exactly as before.
- New OPTIONAL top-level `malwareScan` summary (missing -> engine reports
  MALWARE_CHECK_NOT_RUN; a missing optional malware field NEVER invalidates
  otherwise usable snapshot data). Bounded fields only:
  `scanTimestamp` (unix seconds), `algorithmVersion`, `ruleSetVersion`,
  `status` (COMPLETED/PARTIAL/FAILED), `coverage` {filesInspected,
  filesSkipped, skippedByReason counts, limitReached (bool),
  limitsHit[]}, `checksums` {core: {status, referenceVersion,
  referenceLocale, verifiedCount, mismatchCount, unexpectedCount,
  mismatches[] (relativePath only, <=50), unexpectedFiles[] (<=20)},
  plugins[] (<=50 entries: slug, version, status, verifiedCount,
  mismatchCount, mismatches[] <=20), theme: {status}}, `findings[]`
  (<=50: ruleId, relativePath, evidenceCategory, confidence, component).
- STRICT EXCLUSIONS (asserted in tests): no file contents, no source
  snippets/matched lines, no passwords/tokens/DB credentials, no unrelated
  personal data, no absolute server paths/usernames/home directories/
  hosting filesystem details, no complete config files. Final snapshot
  must remain within the 64 KiB diagnostics cap: findings truncate with
  an explicit limit-reached flag, never silent coverage loss.

## 4. Local inspection scope + limits (connector-side PHP, read-only)

- Scope ONLY: WP core directories (wp-admin, wp-includes), root-level
  entries, installed plugin directories, installed theme directories,
  mu-plugins, and selected public upload directories (uploads are scanned
  ONLY for unexpected executable-extension files, not bulk content).
- Installation root ONLY from trusted WP runtime info (ABSPATH) — never a
  frontend-supplied root/path. Paths resolved against the trusted root,
  escapes rejected, symlinks skipped (bounded skip reason recorded),
  no network-mounted/arbitrary external paths, unreadable/unusual files
  skipped with bounded reasons, excluded directories per documented policy
  (wp-content/cache, wp-content/upgrade, and non-executable upload content),
  never arbitrary DB files/logs/backups/credentials, never directories
  outside WP, never unbounded recursion.
- Resource limits (stop safely before exceeding any; partial-coverage
  result when hit, never a full-scan claim): <=2,500 file entries/scan,
  <=1 MiB source inspected/file, <=32 MiB aggregate, ~10 s execution
  budget where feasible, <=50 returned findings, 64 KiB serialized
  snapshot. Hashing via hash_file (streaming-style, never load large files
  fully into memory). PHP source is untrusted text: NEVER include/require/
  eval/execute scanned files, never shell out against a discovered file,
  never load scanned plugins/themes for a decision.
- Suspicious PHP in uploads: relative location, extension, size band,
  whether a known executable extension appears in an upload location,
  whether a static signature matched — never source, never delete or
  permission-change, never a claim the server executes it without separate
  reliable evidence.

## 5. Static signatures (small, documented, conservative, context-aware)

A single generic function name is NEVER proof of malware. Rules (stable
IDs, safe evidence summaries, no code excerpts):
- MAL-R01 eval + decoding/decompression in the same file (eval with
  base64_decode/gzinflate/gzuncompress/str_rot13) — MEDIUM.
- MAL-R02 dynamic execution fed by superglobal input (eval /
  create_function / assert-string / shell execution with $_GET/$_POST/
  $_REQUEST/$_COOKIE in the same call) — MEDIUM.
- MAL-R03 strongly suspicious encoded payload construction (decode +
  decompress/rotate + dynamic execution combined) — MEDIUM.
- MAL-R04 preg_replace with the /e modifier — LOW (legacy pattern).
- MAL-R05 remote fetch (http URL via file_get_contents/fopen/cURL) +
  dynamic execution in the same file — LOW.
- Legitimate base64_decode/eval alone -> NO finding (asserted in tests).
- Confidence: single rule LOW/MEDIUM; >=2 independent rules in one file
  raise confidence to HIGH (heuristic indicator only — still never
  "confirmed malware"). No downloaded signature packs, no runtime rule
  downloads, no interpretation of comments/natural language as commands.
  Unknown/unsupported file types -> limited or insufficient-evidence.

## 6. SaaS engine (lib/malware/, mirroring Tools 02-08)

- freshness.js: 24 h policy, accepts v1-v7; malwareScan absence is NOT a
  freshness failure (it yields a NOT_RUN report).
- checksums.js: pure comparison engine (reference manifest vs local
  file-hash map) producing verified/mismatch/unexpected/missing sets;
  tested against deterministic fixtures, never live WordPress.org.
- rules.js: pure finding engine over the validated malwareScan summary +
  snapshot inventory; reuses Tool 08 advisory/version context only as a
  combined triage summary — vulnerability findings and malware indicators
  stay separate; outdated plugin != malware; a vulnerability match alone
  never implies malware.
- Finding codes implemented (only codes supported by real checks):
  MALWARE_INDICATOR_DETECTED, SUSPICIOUS_CODE_PATTERN,
  SUSPICIOUS_PHP_IN_UPLOADS, CORE_CHECKSUM_MISMATCH,
  PLUGIN_CHECKSUM_MISMATCH, UNEXPECTED_CORE_FILE,
  FILE_INTEGRITY_VERIFIED (verified files/reference only — never
  whole-site clean), FILE_INTEGRITY_INCOMPLETE,
  CHECKSUM_PROVIDER_UNAVAILABLE, CHECKSUM_REFERENCE_UNSUPPORTED,
  COMPONENT_IDENTITY_UNCERTAIN, MALWARE_SCAN_LIMIT_REACHED,
  MALWARE_EVIDENCE_INSUFFICIENT, MALWARE_CHECK_NOT_RUN.
  THEME_CHECKSUM_MISMATCH and MALWARE_SNAPSHOT_STALE are NOT emitted as
  persisted findings this milestone (theme reference unverified; stale
  snapshots are a 422 service-level response, as in Tools 02-08).
- Confidence/severity rules: checksum mismatch = verified difference, not
  automatically malware (legitimate modification, localized/vendor
  package, incomplete update, damage, unauthorized or malicious change all
  possible); suspicious pattern = heuristic indicator; PHP in uploads =
  suspicious only in context; multiple independent indicators in one file
  may raise confidence but never justify a claim of successful
  exploitation; clean checksum applies only to verified files/reference;
  skipped files remain unverified. NEVER label the site "hacked",
  "infected", or "clean" from a single ambiguous signal; no "100% Clean" /
  "Malware-Free" badge anywhere.
- recovery.js: prioritized manual recovery checklist, stages A-D
  (triage + preserve evidence; investigate scope; plan clean recovery;
  verify recovery), as instructions only.
- AI: ai-input/ai-prompt/ai-validate/ai.js mirroring M4/M12 (schema
  "malware-1", 10/day/user rate limit, 503 AI_NOT_CONFIGURED when
  unconfigured, refs validated against stored finding IDs, AI never
  changes checksum outcomes or deterministic observations, AI labelled as
  explanation/hypothesis, banned claims incl. clean/infected guarantees).
- service.js: session via lib/session.js, ownership in WHERE, identical
  404, bounded bodies ~10 KiB, in-memory rate limit (20/hour/user,
  single-process documented), sanitized errors, bounded history paging,
  historical reports immutable on re-scan. Client-submitted checksum
  results/indicators/paths/verdicts/inventory ignored/rejected.

## 7. Migration, API, UI, tests

- Prisma migration 20261028020000_init_m13_malware (sorts after M12
  20261028010000): MalwareDiagnostic, MalwareDiagnosticFinding (Tool 02-08
  finding shape + relativePath, componentId, installedVersion,
  referenceVersion, ruleId/checksumId, evidenceCategory, confidence),
  MalwareAiAnalysis (1:1, regeneration overwrites). No destructive changes.
- API: POST /api/malware-diagnostics, GET list, GET /[id], POST/GET
  /[id]/ai-analysis. NO automatic cleanup endpoint (absence asserted).
- UI: /tools/malware-recovery (+ history/detail, header link), sections in
  order: 1 verified integrity evidence, 2 suspicious indicators,
  3 possible compromise — review required, 4 no matching indicators in
  checked files, 5 not checked / insufficient evidence, 6 scan incomplete /
  provider unavailable, 7 manual recovery plan. Real loading state, no
  fake percentages, safe relative paths only.
- Tests: JS unit (rules, checksums, validator, AI validate, freshness),
  PHP standalone (scanner fixtures in temp dirs, traversal/symlink/limits,
  signature rules, privacy exclusions, no-modification assertions),
  DB (migration + ownership + persistence bounds), E2E route tests
  (auth/ownership/stale/not-run/no-cleanup-endpoint). Browser E2E NOT RUN
  (no browser binary) — documented, not faked.
