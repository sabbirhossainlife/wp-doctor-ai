# Tool 10 — Backup, Restore & Migration Assistant (Milestone 14) — Plan

## PG preflight outcome (2026-10-28)
- Parent check: no `psql`/`pg_ctl`/`initdb`, no `/usr/lib/postgresql`, no
  data directory anywhere (`/var/lib/postgresql`, `/etc/postgresql` absent).
  This was a VM wipe, as in M11/M13 — nothing existing to overwrite.
- Restoration performed (documented dev-setup restoration, NOT a reset):
  `apt-get install postgresql postgresql-contrib` (16), fresh cluster
  `16/main` started, role `wpdoctor` + databases `wpdoctor_dev` /
  `wpdoctor_test` created from the existing `.env.local` URLs (passwords
  never printed), then `prisma migrate deploy` for dev + test: all
  migrations M1–M13 applied cleanly. No past migration edited, no data
  deleted (there was none — the wipe had already removed it).

## Storage + encryption design (inspected first: no storage abstraction,
## no S3 SDK, no backup env vars existed)
- Only storage implemented: private local adapter (`lib/backup/storage.js`).
  Root from server-only `BACKUP_STORAGE_DIR`; filenames are random
  128-bit IDs, never derived from site/user names; files mode 0600;
  never served from a public directory; no permanent public URL.
- Encryption: Node `crypto` AES-256-GCM, key from server-only
  `BACKUP_ENCRYPTION_KEY` (64 hex chars = 32 bytes, or base64 32 bytes),
  random 12-byte nonce per archive, key identifier = first 16 hex chars of
  SHA-256(key). No key derivation from IDs, no plaintext fallback: if the
  key is missing/unparsable, backup execution is BLOCKED (never silently
  plaintext). Decryption failure / tamper -> verification FAILED, restore
  refused. SaaS can decrypt, so UI/docs say "encrypted at rest by the
  configured service", never "end-to-end encrypted".
- Production gate: local storage is development/test ONLY. In
  `NODE_ENV=production` local storage is BLOCKED (ephemeral-disk risk);
  no S3/object-storage adapter is configured or claimed — production
  backup/restore/migration is BLOCKED until a private, configured
  persistent store + encryption key exist. This is a feature gate, not
  a silent fallback.

## Connector changes (plugin 1.6.0 -> 1.7.0, snapshot schema stays v7)
- New `includes/class-backup.php`, admin-triggered only
  (`manage_options` + WP nonce, "Create backup export" form, separate
  from the diagnostic snapshot): builds a bounded manifest + inventory
  (DB table list/counts via `$wpdb`, file inventory inside the trusted
  scope only), then a ZipArchive package (bounded files/size/time),
  then chunked upload to the new SaaS transfer endpoints using the
  existing Bearer + timestamp + nonce auth. wp-config.php is EXCLUDED
  by default; an explicit opt-in checkbox + warning is required for a
  same-site recovery archive, and it is never shown in UI/logs.
- Scope (connector runtime only, ABSPATH root, no symlinks followed,
  no traversal, caches/upgrade dirs excluded, skipped files listed):
  core + required install files (minus wp-config.php unless opted in),
  `wp-content/plugins`, `wp-content/themes`, `wp-content/mu-plugins`,
  `wp-content/uploads`, `wp-content/languages`.
- The connector does NOT gain a restore-apply endpoint in this
  milestone (see "Blocked" below). Snapshot schema v7 unchanged;
  server validator unchanged.

## Transfer protocol (NOT the 64 KiB diagnostic endpoint)
- Session-authenticated SaaS job creation first (job ID server-generated).
- Connector-authenticated chunk endpoints
  (`/api/connector/backup-transfer/*`, Bearer + ±300s + per-connection
  nonce, same auth as diagnostics): init (binds job+connection, declares
  total bytes/chunks/sha256), chunk (base64, <=1 MiB, sequence + per-chunk
  sha256 validated, duplicates/missing/reordering detected), complete
  (total sha256 validated, then AES-256-GCM encryption + local storage,
  artifact COMPLETED). Tokens are never client-chosen storage keys;
  chunk bodies never logged. A second, session-authenticated path
  (transfer-init/chunk/complete under `/api/backup-jobs/[id]/`) exists
  for tests and for a future SaaS-side uploader; it enforces the same
  validation and ownership.

## Job state machine (single shared model, see schema)
- States: DRAFT, PREFLIGHT, AWAITING_CONFIRMATION, QUEUED, RUNNING,
  VERIFYING, COMPLETED, PARTIAL, FAILED, BLOCKED, CANCELLED,
  FAILED_REQUIRES_REVIEW. Allowed transitions are enforced in
  `lib/backup/states.js`; invalid transitions are rejected, never
  silently coerced. Destructive jobs: at most one non-terminal
  restore/migration job per destination website (duplicate/conflicting
  jobs rejected). Job state is persisted BEFORE any high-impact step.
- Confirmation: typed phrase `RESTORE TO <canonical-host>` /
  `MIGRATE TO <canonical-host>` (server-validated against the plan's
  destination hostname), short-lived one-use authorization token
  (hash only stored, 15 min, bound to user + source + destination +
  operation type + backup + plan hash). Plan/target change invalidates
  it; replay/expiry/wrong-plan rejected. No progress percentages are
  shown — only persisted states and bounded counts.

## What is genuinely implemented vs explicitly BLOCKED
- IMPLEMENTED: backup job creation + preflight (from latest snapshot,
  24 h freshness, multisite detected -> multisite operations BLOCKED,
  storage/encryption readiness, conflicting-job check); manifest v1
  build/validate/hash/tamper detection; AES-256-GCM round trip;
  archive path safety (traversal, symlinks, duplicates, bombs via
  expanded-size/file-count limits); serialization-aware URL rewrite
  for PHP serialized strings (unsupported formats reported, never
  corrupted); chunked transfer validation; encrypted local storage;
  backup list/detail/download (one-use 5-min download token, streamed,
  ownership-checked)/delete (blocked while referenced by an active job);
  restore + migration preflight + dry-run plans (tables/files at risk,
  URL/prefix differences, rollback-backup requirement stated in plan)
  + typed confirmation + token issuance; audit events (no secrets/SQL/
  contents); UI page + header link; unit + DB tests.
- BLOCKED (honest, by design): LIVE RESTORE EXECUTION against a real
  WordPress target and LIVE MIGRATION EXECUTION. Reason: applying an
  archive to a live site (DB import + file replacement + URL rewrite)
  needs a tested connector restore-apply endpoint and a verified
  pre-restore rollback backup on the target; neither exists yet, and
  faking success would violate the brief. Confirmed restore/migration
  jobs therefore end in BLOCKED with code
  `RESTORE_EXECUTION_NOT_IMPLEMENTED` / `MIGRATION_EXECUTION_NOT_IMPLEMENTED`,
  no target mutation, rollback material untouched, and the dry-run plan
  + manual next steps shown. A restore/migration is NEVER reported
  COMPLETED in this milestone.
- ALSO BLOCKED: multisite backup/restore/migration (detected, refused
  with explanation, never a silent single-site backup); arbitrary
  user-uploaded ZIP/SQL as a trusted backup (only WP Doctor AI
  transfer packages accepted); production use with local storage only;
  backup execution without an encryption key; any operation whose
  snapshot is missing/stale or whose connection is not ACTIVE.
- NOT CLAIMED: "complete backup" (modes are DATABASE_ONLY, FILES_ONLY,
  SITE_DATA_BACKUP = DB + supported file scope; excluded categories are
  listed in every manifest), recoverability of any archive until its
  integrity + restore compatibility are verified (verify step runs on
  transfer-complete; restore compatibility itself is BLOCKED above),
  atomicity of any restore/migration, off-site safety (local only).

## Migration (new, sorts after M13)
- `20261028030000_init_m14_backup_restore_migration`: BackupArtifact,
  BackupOperation, BackupOperationEvent, BackupDownloadToken; User and
  Website get back-relations only (no column changes to old tables).
  Never persists archive contents in any JSON field — only manifest,
  counts, sizes, hashes, key identifier, state, plan hash.

## API routes (mirror Tools 01-09 conventions: session auth, ownership
## in WHERE, identical 404, ~10 KiB bodies except chunk endpoint)
- `/api/backup-jobs` (+ `[id]`, `[id]/confirm`, `[id]/cancel`,
  `[id]/transfer-init`, `[id]/transfer-chunk`, `[id]/transfer-complete`)
- `/api/backups` (+ `[id]`, `[id]/download`, `[id]/download-token`,
  `[id]/delete`)
- `/api/restore-jobs` (+ `[id]`, `[id]/confirm`, `[id]/cancel`)
- `/api/migration-jobs` (+ `[id]`, `[id]/confirm`, `[id]/cancel`)
- `/api/connector/backup-transfer/*` (init/chunk/complete, connector auth)
- No general filesystem/SQL/archive/shell endpoint exists.

## UI
- `/tools/backup-restore-migration` (+ artifact detail `[id]`, header
  link): overview + honest limitations, website selector, storage
  readiness, backup creation (mode + included/excluded + sensitive-data
  checkbox), artifact history/detail/integrity, restore dry-run +
  typed confirmation, migration guided steps 1-11 (execution step
  shows the BLOCKED state honestly), job status in persisted-state
  words only, audit/history, blocked/failure states, manual next steps.

## Tests
- Pure (node --test, no DB): manifest, crypto, paths, serialized
  rewrite, transfer validation, preflight, confirmation, state machine,
  storage adapter (temp dir), PHP `php -l` + connector backup stub
  suite (inventory scope, wp-config exclusion, traversal rejection).
- DB (test:db, after PG restoration above): ownership, state
  transitions, duplicate destructive-job prevention, confirmation
  replay/expiry/plan-change invalidation, SaaS-PostgreSQL-is-never-a-
  restore-target assertion (restore target must be a Website row, and
  no code path opens the SaaS DB as a WP target), audit contains no
  secrets, download-token one-use/expiry, delete blocked by active job.
- NOT RUN: browser E2E (no browser binary in VM); live WP backup/
  restore against wp-dev (wp-dev was down at preflight; watchdog owns
  it; connector 1.7.0 upload path is code-reviewed + stub-tested, not
  live-verified — stated in docs, not claimed).
