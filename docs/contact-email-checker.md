# Tool 07 — Contact Form & Email Checker (Milestone 11)

Read-only WordPress diagnostics. This tool never sends an email, never
submits a form, never connects to a mail server, and never changes
anything on the analysed site, in DNS, or in WordPress. It therefore
never verifies delivery: a complete configuration and present SPF/DMARC
records do not guarantee that mail reaches an inbox.

## What is checked

1. **Form plugins** — from a connector snapshot (schema v5): recognised
   plugins, installed/active state, form counts where reliably countable,
   and notification-template completeness (sender + recipient present).
2. **Mail transport** — from the same snapshot: recognised mail plugins,
   mailer identifier, sender configuration (domain only), and whether
   required non-secret fields appear complete.
3. **Sender-domain comparison** — domain-only: the configured sender
   domain vs the diagnostic's email domain. Comparison is established
   server-side only when both domains are known.
4. **Public DNS** — SPF, DMARC, and (with a supplied selector) DKIM TXT
   records for the email domain.

## Adapters implemented, with coverage

| Integration | Coverage | Verification |
|---|---|---|
| Contact Form 7 | COMPLETE | Verified against real CF7 6.2.3 source on local WP 7.1.3: forms are `wpcf7_contact_form` posts, enumerated via `WPCF7_ContactForm::find()` (capped at 200); `prop('mail')` supplies sender/recipient templates. Only the count, per-form sender/recipient presence booleans, and a sender domain (literal-address senders only; mail-tags yield null) are collected. |
| WPForms, WPForms Lite, Gravity Forms, Ninja Forms, Fluent Forms, Elementor Pro forms | UNSUPPORTED | Recognised by inventory slug; no verified adapter, so no counts or config claims. Reported as UNSUPPORTED, never as absent. |
| WP Mail SMTP | PARTIAL | Option schema verified from published source (`wp_mail_smtp` option, `mail.from_email` / `mail.mailer`, `smtp.*` groups); fixture-verified only — NOT installed on local wp-dev, so NOT live-verified. Only the mailer identifier, the from_email domain, and presence booleans are collected. |
| FluentSMTP, Post SMTP | UNSUPPORTED | Recognised by inventory slug; no verified adapter. |
| Unknown / custom forms | UNSUPPORTED | A single `pluginId: "unknown"` entry when no recognised form plugin is present. This never means "no forms exist". |

## Snapshot v5 + backward compatibility

- Connector plugin 1.3.0 → **1.4.0**; snapshot schema v4 → **v5**.
- New keys: `contactForms[]`, `mailTransport[]`, `senderDomain`
  (domain-only comparison block; `comparisonEstablished` is always false
  from the collector — the server establishes the comparison).
- The server validator accepts v1–v5. v1–v4 payloads validate exactly as
  before; a v1–v4 snapshot simply has no contact/email data, which Tool 07
  reports as INSUFFICIENT_EVIDENCE (never "plugin broken", "no forms
  exist", or "mail misconfigured"). A v5 payload missing a v5 section is
  invalid, like v3/v4 before it.
- Pairing, auth, timestamp/replay, 64 KiB cap, identity, and revocation
  are unchanged. Sync remains admin-triggered only; no telemetry, no
  forced sync.

## Freshness policy

24 hours, mirroring Tools 02–04/06, in `lib/contact-email/freshness.js`
(the shared Tool 02 helper is untouched — it still accepts only v1–v4).

- `websiteId` path: ownership in WHERE; server uses the owned record's
  URL and latest snapshot only. Missing / invalid / unsupported / stale
  snapshot → **422 with re-sync instructions, no row persisted**.
- URL-only path: no snapshot; form/mail sections are
  INSUFFICIENT_EVIDENCE, DNS checks still run, and a row IS persisted
  with `snapshotSchemaVersion = null` (the Tool 05/06 URL-only precedent).

## DNS design + bounds

- Server-side Node `dns/promises` TXT lookups, resolver-injectable for
  tests. Per-query timeout 5 s; at most 3 queries (SPF, DMARC, DKIM) run
  sequentially; max 50 TXT records per hostname; each stored excerpt
  capped at 512 characters.
- Only the validated public email domain (and its `_dmarc.` /
  `._domainkey.` subdomains) is ever queried. No private-network queries.
- Failure/timeout → `EMAIL_DNS_LOOKUP_FAILED` / PARTIAL for that check
  only; other findings are preserved.

### Email-domain validation and the default-domain rule

- User-supplied `emailDomain` must be a valid multi-label public domain:
  IP literals, localhost, single-label names, and malformed domains are
  rejected (400).
- Default rule (exact): take the host of the snapshot `homeUrl`
  (websiteId path) or the target URL (URL-only path); strip ONE leading
  `www.`; accept it ONLY if it then passes the public-domain check.
  Otherwise the domain is unknown and DNS checks are
  INSUFFICIENT_EVIDENCE. No public-suffix derivation, no guessing.

### SPF / DMARC / DKIM coverage and limitations

- **SPF:** domain TXT. A record counts only if it starts with `v=spf1`
  (case-insensitive, after trimming); unrelated TXT is ignored. Outcomes:
  none / one / multiple / syntax-warning. Syntax anomalies actually
  checked (nothing more claimed): multiple `v=spf1` records; an empty TXT
  record; an SPF-like record (contains `include:`, `ip4:`, `ip6:`, or
  `all`/`mx`/`a` mechanisms) without a `v=spf1` tag. NOT evaluated:
  lookup limits, include chains, or full RFC compliance.
- **DMARC:** `_dmarc.<domain>` TXT. Outcomes: none / single parseable /
  multiple-conflicting / malformed (a `v=DMARC1` record without a valid
  `p=` tag). `p=none` is MONITORING (LOW finding, never an error) and
  this tool never recommends a policy change automatically.
- **DKIM:** ONLY with a validated selector — user-supplied
  (`[A-Za-z0-9_-]{1,63}`) or reliably available from supported non-secret
  config (no current adapter yields one, so in practice user-supplied
  only). Query `<selector>._domainkey.<domain>`; present vs not found.
  Selector omitted/invalid → `DKIM_SELECTOR_UNKNOWN` / NOT_CHECKED.
  Selectors are never guessed; DKIM is never declared missing from an
  unknown selector. Record presence ≠ signature or delivery verification.

## Finding codes and status vocabulary

Codes: `FORM_PLUGIN_NOT_FOUND`, `FORM_PLUGIN_INACTIVE`,
`FORM_NOTIFICATION_CONFIG_INCOMPLETE`, `FORM_CONFIGURATION_UNSUPPORTED`,
`MAIL_TRANSPORT_UNIDENTIFIED`, `MAIL_TRANSPORT_CONFIG_INCOMPLETE`,
`SENDER_DOMAIN_MISMATCH`, `SPF_RECORD_PRESENT`, `SPF_RECORD_MISSING`,
`SPF_MULTIPLE_RECORDS`, `SPF_SYNTAX_WARNING`, `DMARC_RECORD_PRESENT`,
`DMARC_RECORD_MISSING`, `DMARC_RECORD_INVALID`,
`DMARC_POLICY_MONITORING`, `DKIM_RECORD_PRESENT`,
`DKIM_RECORD_NOT_FOUND`, `DKIM_SELECTOR_UNKNOWN`,
`EMAIL_DNS_LOOKUP_FAILED`, `EMAIL_EVIDENCE_INSUFFICIENT`,
`DELIVERY_NOT_VERIFIED` (LOW, attached to every COMPLETED report).
(`EMAIL_SNAPSHOT_STALE` has no finding row by design: a stale snapshot
blocks the run at 422 with no row persisted.)

Evidence status per finding: CONFIRMED / POTENTIAL /
INSUFFICIENT_EVIDENCE. Execution status (COMPLETED / PARTIAL / FAILED)
is separate: a completed read revealing missing mail settings is
COMPLETED with findings; a DNS timeout is PARTIAL.

Hard invariants: absent recognised plugin ≠ no forms exist; unknown
config ≠ failure; absent SMTP plugin ≠ failure (PHP mail or another
integration may be used); config present ≠ delivery verified; no form
failure is claimed without an authorised submission test (none is
performed); inferred cause is never presented as proven root cause.

## API routes

- `POST /api/contact-email-diagnostics` — fields read: `websiteId`,
  `url`, `emailDomain` (optional), `dkimSelector` (optional). Everything
  else (findings, snapshots, observations, ownership) is ignored.
  201 on success; 400 validation; 401 unauthenticated; 404 unknown/other
  user's website; 422 stale/missing/invalid snapshot; 429 rate limit
  (20/hour/user, in-memory, single-process — same limitation as
  Tools 02–06).
- `GET /api/contact-email-diagnostics` — own only, desc, bounded paging.
- `GET /api/contact-email-diagnostics/[id]` — ownership in WHERE;
  identical 404 for nonexistent vs another user's.
- `POST/GET /api/contact-email-diagnostics/[id]/ai-analysis` — explicit
  trigger only; reuses the M4 provider with strict `contact-email-1`
  schema; grounded in saved deterministic findings only; references
  validated; AI never overwrites SPF/DMARC/DKIM/plugin/snapshot
  observations; no secrets, visitor data, unredacted recipients, or full
  config sent; 503 `AI_NOT_CONFIGURED` when unconfigured — the
  deterministic report stands alone; no mock AI content in production.
  Banned AI claims include delivery/submission verification, DKIM-missing
  from an unknown selector, guaranteed acceptance, automatic DMARC
  enforcement, and proven-root-cause language.

## UI

`/tools/contact-email-checker` (+ history/detail, header link):
registered-website selector (recommended) or URL-only input, optional
email-domain input, optional DKIM selector field with a when-useful
explanation, Run Diagnostics button, real pending state without
fabricated percentages, actionable errors, and a report split into
Observed configuration / DNS results / Potential issues /
Not checked — insufficient evidence / Recommended actions / AI
explanation. DNS results show the queried hostname and bounded public
TXT excerpts only; form config shows normalised indicators + adapter
coverage, never entries, recipients, private config, or page content.
The report never claims an email was sent, a form was submitted, or
delivery was verified.

## Privacy / data minimisation safeguards

Stored per diagnostic: a BOUNDED COPY of the analysed snapshot fields
(contactForms + mailTransport + sender comparison only), SPF/DMARC/DKIM
observations (public TXT excerpts, capped), and the summary. Never
stored: secrets, credentials, full email addresses, recipients, form
submissions, message bodies, order/customer records, full page content,
arbitrary `wp_options` contents, full SMTP config objects, mail logs
with personal data, or raw config. The PHP collector asserts the same
allowlist: sentinel secrets in fixtures never appear in collector output
(`tests/php-contact-email.test.php`). Historical reports are immutable
on re-scan.

## Versions / configurations actually tested

- Connector PHP: stub suites (no live WP install during this work —
  wp-dev services were down and its MariaDB/PHP packages had been wiped
  by a VM replacement; PHP 8.3 CLI + PostgreSQL 16 were restored from
  the local package cache for this milestone's tests). CF7 adapter
  verified against real CF7 6.2.3 source on disk; WP Mail SMTP adapter
  fixture-verified only (plugin not installed on wp-dev).
- JS: deterministic fixtures + injected DNS resolver (no live DNS
  dependence for core rules); DB tests against real PostgreSQL 16
  (dev + test databases, freshly created on the restored cluster — the
  pre-existing dev/test data had already been lost to the VM wipe
  before this milestone began, so no user data was deleted by it).
- HTTP E2E against a running server (loopback URL-only run, no external
  DNS; requires `BETTER_AUTH_URL` to match the E2E base URL or Better
  Auth rejects sign-up with INVALID_ORIGIN).
- Browser E2E: NOT RUN (no browser binary in this VM).
- Production domain: still unconfirmed. Production AI: NOT_CONFIGURED
  (503) — no live provider key exists; all provider tests use mocks.

## Deployment requirements

- Prisma migration `20261028001000_init_m11_contact_email` applied
  (dev + test verified; sorts after M10's `20261027230000`).
- Connector plugin 1.4.0 on connected sites for v5 snapshots; older
  plugin versions keep working for Tools 02–06 and yield
  INSUFFICIENT_EVIDENCE (not errors) for Tool 07's snapshot sections.
- No new environment variables. No new dependencies.
