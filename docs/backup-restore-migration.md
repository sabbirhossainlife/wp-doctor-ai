# Tool 10 — Backup, Restore & Migration Assistant (Milestone 14)

Authenticated, user-controlled, verified — never fake success.
See also docs/tool10-plan.md (the pre-implementation plan, including
the PostgreSQL preflight outcome).

## Honest scope — read this first

IMPLEMENTED in this milestone: backup job creation + preflight,
chunked transfer + encrypted storage + integrity verification,
manifest v1, restore/migration dry-run planning + typed confirmation,
audit, backup history/detail/download/delete, serialization-aware URL
rewriting (pure engine), and the connector 1.7.0 backup exporter.

BLOCKED in this milestone, by design: LIVE RESTORE EXECUTION and LIVE
MIGRATION EXECUTION against a real WordPress site. A confirmed
restore/migration job ends in state BLOCKED with code
`RESTORE_EXECUTION_NOT_IMPLEMENTED` /
`MIGRATION_EXECUTION_NOT_IMPLEMENTED`, no target mutation, and the
dry-run plan + manual next steps shown. Rationale: applying an archive
to a live site (DB import + file replacement + URL rewrite) needs a
tested connector restore-apply endpoint and a verified pre-restore
rollback backup on the target; neither exists yet, and reporting
success without them would be fabrication. A restore/migration is
therefore NEVER reported COMPLETED in this milestone, and no backup
is described as recoverable until integrity + restore compatibility
are verified to the supported level (integrity IS verified on
transfer-complete; restore compatibility awaits execution).

ALSO BLOCKED: multisite operations (detected, refused); arbitrary
user-uploaded ZIP/SQL as a trusted backup (only WP Doctor AI transfer
packages); production operation with local-only storage or without an
encryption key; operations on missing/stale snapshots or inactive
connections.

## PostgreSQL preflight outcome

Parent preflight (2026-10-28 ~09:54 +06): no PostgreSQL binaries, no
data directory anywhere — a VM wipe. Restoration performed (documented
dev-setup restoration, not a destructive reset): PostgreSQL 16
installed via apt, fresh cluster started, role `wpdoctor` +
`wpdoctor_dev` / `wpdoctor_test` recreated from the existing
`.env.local` URLs (passwords never printed), all migrations M1–M13
applied via `prisma migrate deploy`, then the new M14 migration
applied to both databases. No past migration was edited and no data
was deleted (none survived the wipe).

## Storage + encryption configuration (actually present vs missing)

- Present in code: private local storage adapter only
  (`lib/backup/storage.js`). Root from server-only `BACKUP_STORAGE_DIR`;
  filenames are random 128-bit IDs; files mode 0600; nothing is
  publicly served; no permanent public URL exists.
- Present in code: AES-256-GCM via Node built-in `crypto`
  (`lib/backup/crypto.js`), key from server-only
  `BACKUP_ENCRYPTION_KEY` (64 hex chars or base64 32 bytes), random
  12-byte nonce per archive, key identifier = first 16 hex of
  SHA-256(key). No key derivation from IDs, no plaintext fallback.
- Missing by default (not in `.env.local`, not in `.env.example`
  values): `BACKUP_STORAGE_DIR`, `BACKUP_ENCRYPTION_KEY`,
  `BACKUP_STORAGE_DRIVER`. Until they are set, backup execution is
  BLOCKED by the gates (never silently plaintext, never silently
  local-ephemeral). Example (server-only, never committed, never
  `NEXT_PUBLIC_*`):
  `BACKUP_STORAGE_DRIVER="local"`, `BACKUP_STORAGE_DIR="/var/private/wp-doctor-backups"`,
  `BACKUP_ENCRYPTION_KEY="<64-hex-chars>"`.
- Production: local storage is BLOCKED when `NODE_ENV=production`.
  No S3/object-storage adapter is configured, implemented, or claimed;
  production backup/restore/migration requires a private persistent
  store + encryption key to be configured first.
- Disclosure: backups are encrypted at rest BY THE CONFIGURED
  SERVICE (which holds the key) and transmitted over TLS. This is not
  end-to-end encryption, and off-site safety is NOT claimed for local
  storage.

## Archive format + manifest structure

- Package: a ZIP (`wp-doctor-ai-backup-zip-v1`) containing
  `manifest.json`, `database.sql` (DB modes), and the in-scope files
  at relative paths. Before trust, the SaaS parses the ZIP central
  directory (no extraction in this milestone) and validates every
  entry: relative path only, no traversal, no symlinks, no special
  files, no duplicates, per-file and expanded-size limits.
- Manifest v1 fields: format/formatVersion, backupId, ownerUserId,
  websiteId, siteIdentity {canonicalHost, homeUrl}, mode, createdAt,
  connectorVersion, connectorSchemaVersion, wordpressVersion,
  phpVersion, dbEngine/dbVersion (when known), multisite,
  tablePrefix, includedCategories, excludedCategories, skippedFiles,
  tableCount, rowCount, fileCount, estimatedBytes, archiveBytes,
  coverage, limitations, includesWpConfig, encryption
  {scheme, version, keyId — never the key}, verificationStatus,
  integrity {manifestSha256, archiveSha256}. Manifest integrity is
  SHA-256 over canonical JSON (keys sorted) excluding the integrity
  field itself; tampering fails closed. No server secrets, storage
  credentials, private URLs, SQL, or file contents appear in any
  user-visible report; the internal storage ID is never returned by
  the API.

## Backup modes truly supported

- `DATABASE_ONLY`: tables from the site's own `$wpdb` (schemas via
  SHOW CREATE TABLE + rows in 500-row batches), via the connector.
- `FILES_ONLY`: fixed scope — root install files, wp-content/plugins,
  themes, mu-plugins, uploads, languages. Caches + upgrade temp dirs
  excluded; symlinks skipped; files outside the WP root never read.
- `SITE_DATA_BACKUP`: database + file scope above, plus wp-admin and
  wp-includes. This is a SITE-DATA backup, not a complete
  hosting/server image: hosting config, server settings, SSH keys,
  `.env` files, other installs, and unrelated directories are never
  included. `wp-config.php` is excluded by default; it is included
  only with an explicit administrator opt-in for a same-site recovery
  archive, with a secrets warning, and it is NEVER copied over a
  destination's config during cross-site migration.

## Restore capabilities + safety gates

- Supported in this milestone: restore job creation, preflight
  (backup owned + VERIFIED, manifest valid + integrity verified,
  destination owned, destination snapshot fresh (24 h), connection
  ACTIVE, storage + encryption ready, no conflicting destructive job
  for the destination), dry-run plan (DB strategy, file strategy,
  categories at risk, exclusions, URL/prefix differences, rollback
  requirement, limitations, verification strategy), typed
  confirmation, one-use token bound to the exact plan hash, audit
  events, and honest BLOCKED execution (see scope above).
- NOT supported yet: actual DB import, file replacement, URL rewrite
  application, pre-restore rollback-backup creation, automatic
  rollback, or post-restore verification against a live target. The
  dry-run plan states the rollback requirement explicitly
  (`rollbackBackupId: null` until a verified rollback exists), and
  execution refuses to proceed without it — there is no override that
  bypasses a failed rollback backup, because no override is
  implemented at all.
- Safety invariants (tested): dry-run never modifies the target;
  confirmation of one plan never authorizes a different plan
  (plan-hash revalidation; tampering -> 409); expired/replayed/
  wrong-target confirmations rejected; corrupted archives cannot
  restore (manifest + archive checks fail before planning); invalid
  table/relative paths rejected; duplicate destructive jobs for one
  destination rejected; ambiguous failure -> FAILED /
  FAILED_REQUIRES_REVIEW with mutations stopped, never blind retry.
- The SaaS PostgreSQL database is NEVER a restore target: targets are
  Website rows (registered WordPress sites owned by the user). No
  code path accepts a database URL/host/credential as a target, and
  no WordPress database is ever opened from the SaaS side in this
  milestone (the connector's `$wpdb` export runs inside WordPress).

## Migration features + limitations

- Guided workflow (UI steps 1–11): select source, select destination
  (must differ; arbitrary destination URLs rejected — both must be
  registered sites owned by the user), compare (WP/PHP versions from
  snapshots; differences warned, not assumed compatible), review
  limitations, create/verify source backup (required) + destination
  rollback backup (required before any future execution; currently
  always missing, which independently blocks execution), preview the
  plan, review URL/serialized-data handling, review destination
  overwrite risks, confirm the exact plan by typing
  `MIGRATE TO <destination-host>`, execute (BLOCKED in M14), verify
  (future), final results + rollback instructions.
- URL rewriting engine (`lib/backup/serialized.js`, pure + tested):
  serialization-aware for PHP serialized strings (byte-lengths
  recomputed, multibyte-safe), plain-text occurrences rewritten, and
  object/reference/custom-serialized payloads copied verbatim and
  reported as unsupported — never rewritten blindly, never corrupted.
  It is NOT yet applied to a live destination (execution blocked).
- Destination config is never overwritten from the source:
  destination wp-config.php, DB credentials, secret keys/salts,
  hosting config, and host secrets are excluded by the plan.
- Source health: Tools 06–09 evidence is advisory only. Migrating a
  suspicious or incompletely verified source can reproduce its
  problems on the destination; the plan says so, and no automatic
  disinfection or modification of source files happens. The source is
  NEVER deleted by a migration.

## API routes

- `POST/GET /api/backup-jobs`, `GET /api/backup-jobs/[id]`,
  `POST /api/backup-jobs/[id]/confirm|cancel`,
  `POST /api/backup-jobs/[id]/transfer-init|transfer-chunk|transfer-complete`
  (chunk bodies up to ~2 MB JSON; all other bodies ~10 KiB).
- `GET /api/backups`, `GET /api/backups/[id]`,
  `POST /api/backups/[id]/delete` (requires matching artifactId +
  confirm), `POST /api/backups/[id]/download-token`,
  `GET /api/backups/[id]/download?token=…` (streamed, one-use).
- `POST/GET /api/restore-jobs` (+ `[id]`, `[id]/confirm`, `[id]/cancel`),
  `POST/GET /api/migration-jobs` (+ same).
- `POST /api/connector/backup-transfer/[jobId]/init|chunk|complete`
  (connector auth: Bearer + timestamp + nonce; job resolves through
  the connection's website, never client-supplied ids).
- All session routes: authentication + ownership in WHERE, identical
  404 for nonexistent vs another user's records, bounded errors, no
  stack traces or filesystem details. No general-purpose
  filesystem/SQL/archive-extraction/shell/arbitrary-connector-command
  endpoint exists anywhere.

## AI behavior

None. Tool 10 uses no AI provider, no AI input, and no AI analysis.
(M4 production AI remains NOT_CONFIGURED / 503 for the tools that do
use it; that is unchanged.)

## Privacy / data-minimization safeguards

- Backup contents are never displayed in the dashboard, never logged,
  and never stored in PostgreSQL (only manifest + counts + hashes +
  key id). Audit events record user/source/destination ids, operation
  type, scope, confirmation + plan identifiers, backup ids, state
  transitions, timestamps, counts, verification outcomes, sanitized
  errors, and rollback status — never passwords, DB credentials,
  encryption keys, SQL dumps, source code, private file contents,
  auth tokens, or long-lived storage URLs.
- Download: session + ownership + one-use 5-minute token, streamed
  with `Cache-Control: no-store`, no permanent public URL. If a
  download decrypts for the user, transmission is over TLS (the
  download route itself runs over the app's HTTPS in production).
- Retention/deletion: no silent deletion by internal default; provider
  lifecycle limits (none configured for local storage) are disclosed
  as "not configured"; owner-initiated deletion verifies the storage
  result and refuses while an active operation needs the backup;
  rollback copies are preserved while their operation is active or
  uncertain. Deletion logs metadata only, never archive contents.

## Security limitations

- Chunk staging lives on disk under the storage root (not only in
  memory) and is cleaned on complete/cancel/failure, but a crashed
  process may leave a staging directory; staging holds the (still
  unencrypted) package until encryption on complete, so the storage
  root must be private with restricted permissions — documented as a
  deployment requirement, not assumed.
- In-memory rate limits are single-process (same documented
  limitation as Tools 02–09); a shared store is the production
  replacement.
- ZIP parsing validates the central directory only; full extraction
  safety (including per-file content checks) belongs to the future
  restore implementation and is not claimed here.
- No live backup/restore against a real WordPress site was performed
  in this milestone: connector 1.7.0 is stub-tested (scope, wp-config
  exclusion, traversal/symlink handling, DB export shape) and
  code-reviewed, not live-verified. wp-dev was down at preflight and
  is owned by wp-dev-watchdog; it was not probed for plugin inventory
  in this milestone, and no claim about its current plugin state is
  made here.

## Deployment requirements

1. PostgreSQL with all migrations M1–M14 applied
   (`20261028030000_init_m14_backup_restore_migration`).
2. Server-only `BACKUP_STORAGE_DIR` (private, restricted permissions,
   persistent disk — NOT ephemeral) and `BACKUP_ENCRYPTION_KEY`
   (32 bytes, hex or base64). Without both, operations are BLOCKED.
3. Connector plugin 1.7.0 on the WordPress site for backup export;
   diagnostic snapshots remain schema v7 (validator unchanged).
4. HTTPS in production (TLS for transfers/downloads).
5. Production SaaS domain still unconfirmed (as in M0–M13).

## Tests run (honest labels)

- Unit (deterministic, no DB): 434/434 via `npm test`, including 11
  new Tool 10 pure tests (manifest/crypto/paths/ZIP/serialized/
  transfer/confirmation/states/preflight/plans/storage).
- DB (real PostgreSQL, test database, fixture snapshots): 120/120
  via `npm run test:db`, including 5 new Tool 10 DB tests
  (preflight blocking, chunked transfer + verified artifact,
  download-token one-use, restore/migration confirmation + BLOCKED
  execution, deletion rules, SaaS-DB-not-a-target).
- Connector PHP: `php tests/php-backup.test.php` green (scope,
  wp-config exclusion/opt-in, cache/symlink exclusion, DB export
  shape, invalid mode, no-eval/no-shell static checks); `php -l`
  clean for every plugin file.
- Lint clean (`npm run lint`); production build green
  (`npm run build`, all Tool 10 routes + UI present).
- NOT RUN: browser E2E (no browser binary in this VM); HTTP-level
  E2E for Tool 10 routes (not written — DB tests cover the service
  layer the routes call; route-level E2E is future work, not
  claimed); live WordPress backup/restore (see limitations above).
