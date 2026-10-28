# Deployment checklist — WP Doctor AI (final integration, 2026-10-28)

Status at time of writing: **controlled staging only**. Production launch
is BLOCKED by the items marked BLOCKER below. Nothing in this file invents
a production domain, provider, token, or key: every value must be supplied
by the deployer. Do NOT copy values from `.env.local` (dev) into production.

## Runtime (verified in package.json)

- Node 24 (dev verified on v24.22.1), Next.js 15 App Router, React 19,
  Prisma 6.14, PostgreSQL 16. Build: `npm run build`; start: `npm start`.
- No deployment-target files exist in this repo (no Vercel/Netlify/Docker/
  Render config). The hosting provider is **not chosen**; pick one that
  supports: a long-running Node server (route handlers, not static export),
  PostgreSQL, a private persistent filesystem or object store for backups,
  and an external cron/scheduler. Do not deploy as a static site.

## Pre-deploy steps (in order)

1. Provision PostgreSQL (production instance, separate from dev/test).
   Set `DATABASE_URL` to it. Run `prisma migrate deploy` — never
   `prisma migrate reset`, never drop the database, never edit an applied
   migration. Verify with `prisma migrate status`: all 15 migrations
   M1–M16 applied, none pending. (Latest:
   `20261028050000_init_m16_uptime_monitor`.)
2. Set `BETTER_AUTH_SECRET` to a fresh long random string (32+ bytes) and
   `BETTER_AUTH_URL` to the exact public HTTPS origin. Do NOT weaken
   Better Auth origin validation to make tests pass. Cookies are
   Secure/SameSite in production via the library defaults over HTTPS.
3. Build and smoke-test: `npm run lint && npm test && npm run test:db &&
   npm run build`. Confirm `/api/health` returns ok and the authenticated
   `GET /api/readiness` report shows no BLOCKED database component.
4. TLS/HTTPS is mandatory in production (Secure cookies, connector
   pairing, tick-secret transport). Security headers and production error
   reporting are deployer responsibilities on the chosen host; no
   security-header middleware exists in this codebase — do not claim
   otherwise.

## BLOCKER — Backup storage + encryption (Milestone 14, PARTIAL)

- `BACKUP_STORAGE_DRIVER`, `BACKUP_STORAGE_DIR`,
  `BACKUP_ENCRYPTION_KEY` are **absent from every environment** (dev
  `.env.local` and `.env.example` placeholders only). Backup execution is
  therefore BLOCKED by design, never plaintext.
- Production local storage is BLOCKED in code. No S3/object-storage
  adapter exists or is claimed. Before any production backup/restore/
  migration: implement or integrate a private persistent object store,
  configure its access controls, set a 32-byte encryption key via a
  secret manager (never in git, never in `NEXT_PUBLIC_*`), and verify a
  backup round-trip (export → encrypted store → integrity verify →
  download under a one-use token) in staging.
- Retention policy: **not defined** — the deployer/owner must define it
  (how long artifacts and rollback backups are kept, when they are
  deleted) before production use. Do not claim off-site durability for
  local storage.
- Live restore/migration execution is BLOCKED in code
  (`RESTORE_EXECUTION_NOT_IMPLEMENTED` /
  `MIGRATION_EXECUTION_NOT_IMPLEMENTED`): confirmed jobs end BLOCKED
  with no target change. Remaining work: a tested connector
  restore-apply endpoint, a verified pre-restore rollback backup, and
  disposable-target integration tests. Until then, M14 stays PARTIAL.

## BLOCKER — Scheduled monitoring (Milestone 16, NOT OPERATIONAL)

- The tick endpoint, lease claiming, incident detection, and in-app
  notifications are implemented and tested, but **no external scheduler
  is configured anywhere**. See `docs/scheduler-setup.md` for the exact
  setup and the evidence rule: `lastTickAt` persisted by a real tick is
  the only proof of operation; a configured secret alone proves nothing.
- Until a scheduler demonstrably runs, the uptime page and
  `/api/monitoring/health` honestly report inactive, and the product
  must not be sold or described as providing recurring monitoring.

## NOT_CONFIGURED — AI and email (by design, not failures)

- AI: no provider key is configured in any environment. Deterministic
  diagnostics work standalone; AI explanations return 503
  `AI_NOT_CONFIGURED`. To enable: set server-side `AI_PROVIDER`,
  `OPENAI_API_KEY`, `OPENAI_MODEL` (optional `AI_TIMEOUT_MS`,
  `AI_MAX_OUTPUT_TOKENS`) and run one sanitized provider check. Never
  require AI for core diagnostics.
- Email: no email-delivery adapter exists (`EMAIL_NOT_CONFIGURED`
  always). SMTP variables in `.env.example` are placeholders only.
  In-app notifications work without email. Never use a monitored site's
  SMTP credentials for WP Doctor AI alerts. Do not send test emails to
  unintended recipients.
- Search Console: no integration exists (Tool 11 reports signals only).

## Known production limitation — rate limiting

- All rate limiters (scanner, per-tool, AI, connector, Better Auth) are
  **in-memory, single-process**. They do not protect a multi-instance
  deployment. Options before multi-instance production: single-instance
  deployment (documented limitation), or a shared store (Redis or an
  atomic database-backed limiter) with a defined fail-closed behaviour
  when the store is unavailable. Do NOT silently raise limits or bypass
  them when a shared store fails. The authenticated `/api/readiness`
  report flags this as `sharedRateLimit: NOT_CONFIGURED`.

## Operations

- DB backup + recovery: back up production PostgreSQL on the host's
  schedule and test a restore into an isolated instance before relying
  on it. The SaaS PostgreSQL database is **never** a WordPress restore
  target.
- Startup failure: check DB connectivity first (`prisma migrate status`,
  then `/api/health`), then env presence (names only — never print
  values), then the build log. Never "fix" a migration problem by
  deleting the database.
- Failed restore/migration (staging, once execution exists): stop,
  preserve the rollback backup, mark the job PARTIAL/FAILED_REQUIRES_
  REVIEW, record the last confirmed stage, and do not retry destructive
  steps blindly.
- Missing/delayed monitor checks: check `/api/monitoring/health`
  `lastTickAt` first; if stale, the external scheduler — not the app —
  is the prime suspect. Check tick-endpoint auth (401 = wrong secret,
  503 = secret unset) before touching monitor code.
- Blocked/partial diagnostics: a BLOCKED or PARTIAL result is a truthful
  outcome, not an error to paper over; the UI shows the blocker code
  and the manual next step.

## Controlled-staging smoke test (before any production review)

1. Fresh staging DB, `prisma migrate deploy`, all suites green.
2. Register a disposable WordPress site, pair connector 1.7.0, run one
   diagnostic per tool (12), confirm ownership isolation (a second user
   cannot fetch the first user's report by ID → 404/401, never data).
3. Backup: with dev-only local storage + key configured in staging,
   run a backup job end to end and verify integrity + one-use download.
   Confirm restore/migration confirmation still ends BLOCKED.
4. Monitoring: manual check works; tick with a wrong secret → 401,
   without a secret configured → 503; only a real scheduler invocation
   may be reported as recurring.
5. Confirm AI/email/Search Console still report NOT_CONFIGURED honestly
   and do not break unrelated tools.
