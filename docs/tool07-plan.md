# Tool 07 — Contact Form & Email Checker: implementation plan (Milestone 11)

## Decisions (from real code inspection, not assumptions)

- **Stack verified:** Next 15.5 App Router, React 19, JS/JSX only, Prisma 6.14,
  Better Auth, existing PHP connector, M4 AI adapter (`lib/ai/`).
- **Connector versioning convention:** plugin 1.3.0 (schema v4) → **1.4.0
  (schema v5)**. Server validator accepts v1–v5; v1–v4 validate exactly as
  before. Missing v5 fields → `INSUFFICIENT_EVIDENCE`, never "plugin broken".
- **wp-dev plugin inventory (read from disk, 2026-10-27):** akismet,
  contact-form-7 (6.2.3), elementor, hello.php, mivloo-core, woocommerce,
  wordpress-seo. **No mail plugin is installed** (no WP Mail SMTP, FluentSMTP,
  or Post SMTP), and wp-dev services were not running during this work, so no
  live WP database probe was performed. Adapter verification below is
  therefore: CF7 — verified against real CF7 6.2.3 source on disk;
  WP Mail SMTP — verified against its published option schema (see below),
  fixture-verified only, coverage PARTIAL, never claimed live-verified.
- **URL vs websiteId:** both supported, mirroring Tools 05/06 for URL-only
  runs and Tools 02–04 for connected runs:
  - `websiteId` supplied → ownership in WHERE; server uses the owned record's
    URL and its latest snapshot only. Freshness gate 24 h (own freshness
    module, accepting schema v1–v5; the shared Tool 02 freshness helper is
    NOT modified). Stale / missing / invalid / unsupported → **422, no row
    persisted**, with re-sync instructions — exactly the Tools 02–04/06
    convention.
  - URL-only → no snapshot: form/mail sections are INSUFFICIENT_EVIDENCE,
    DNS checks still run, row persisted with `snapshotSchemaVersion = null`.
    This is the Tool 05/06 URL-only precedent, not a Tool 02-style block.
- **Adapters actually implemented:**
  - Contact Form 7 — COMPLETE (live source verified). Forms are
    `wpcf7_contact_form` posts; `WPCF7_ContactForm::find()` enumerates them;
    `prop('mail')` gives `sender`/`recipient` templates. Collector reads
    ONLY: form count (capped at 200, publish + any status via `find()`),
    per-form booleans (sender non-empty, recipient non-empty), and a sender
    domain ONLY when the sender template is a literal email address
    (mail-tags such as `[your-email]` yield domain `null`). Never: titles,
    recipients, subjects, bodies, submissions, entries.
  - WP Mail SMTP — PARTIAL, fixture-verified only (option schema verified
    from published source: option key `wp_mail_smtp`, groups
    `mail.from_email` / `mail.mailer` and `smtp.*`; defaults show
    `mailer: 'mail'`). Collector reads ONLY `get_option('wp_mail_smtp')`:
    mailer identifier string, from_email domain only, and booleans for
    presence of required non-secret fields and of secret fields
    (host/user/pass/api-key presence as booleans only). Never a secret
    value, host, username, or full address. If the option is absent or not
    an array → all fields `unknown`. Not installed on wp-dev, so this
    adapter is NOT live-verified; the docs and the entry's coverage say so.
  - Known-but-unimplemented form/mail plugins → an entry with
    `coverage: UNSUPPORTED` (form slugs: `wpforms`, `wpforms-lite`,
    `gravityforms`, `ninja-forms`, `fluentform`, `elementor-pro` forms;
    mail slugs: `wp-mail-smtp` is implemented, `fluent-smtp`,
    `post-smtp` are UNSUPPORTED). This is honest: installed + recognised
    as a form/mail plugin, but no adapter, so no counts or config claims.
  - Anything else → a single `{ pluginId: "unknown", coverage: UNSUPPORTED }`
    entry for forms when no recognised entry exists and the inventory ran;
    never "no forms exist".
- **Mail-transport / sender-domain comparison:** comparison target is the
  diagnostic's `emailDomain` (user-supplied, validated) or the documented
  default below. Output is ONLY `{ senderConfigured, senderDomain,
  domainMatches, comparisonEstablished }`. Sender domain = domain part only.
  Never assume admin-email domain = sender domain.
- **Default emailDomain rule (exact):** take the host of the snapshot
  `homeUrl` (websiteId path) or of the target URL (URL-only path); strip ONE
  leading `www.`; accept ONLY if the result is a valid multi-label public
  domain (≥ 2 labels, TLD ≥ 2 letters, all labels DNS-safe, not an IP,
  not localhost, not a single label). Otherwise `emailDomain = unknown`
  and DNS checks are INSUFFICIENT_EVIDENCE. No registrable-domain
  derivation beyond stripping `www.` (no public-suffix list, no guessing).
- **DNS design (Source B, optional, server-side, injectable resolver):**
  Node `dns/promises` `resolveTxt`, per-query timeout 5 s (Promise.race),
  at most 3 queries (SPF, DMARC, DKIM) run sequentially (concurrency ≤ 3),
  max 50 TXT records per hostname, each record string capped at 512 chars
  in stored excerpts, total wall time bounded by the three timeouts.
  Resolver is injectable (`deps.dns`) so core rules never depend on public
  DNS. Failures/timeouts → `EMAIL_DNS_LOOKUP_FAILED` / PARTIAL, other
  findings preserved. No private-network queries: the queried hostname is
  always derived from the validated public `emailDomain`.
  - SPF: domain TXT; record = starts with `v=spf1` case-insensitively
    after trimming. Outcomes: none / one / multiple / syntax-warning.
    Syntax anomalies actually checked (nothing more claimed): multiple
    `v=spf1` records; an empty TXT record; an SPF-like record (contains
    `include:`, `ip4:`, `ip6:`, `a`, `mx`, or `all` mechanisms) that does
    not start with `v=spf1`. No lookup-count, include-chain, or full
    RFC compliance evaluation.
  - DMARC: `_dmarc.<domain>` TXT; none / single parseable / multiple /
    malformed. `p=` parsed from `;`-separated tags; `p=none` is MONITORING
    (LOW finding, never an error); `p=quarantine|reject` are enforcement
    (no finding beyond a LOW positive note — recorded in the observation).
    Missing `p=` on a `v=DMARC1` record → invalid.
  - DKIM: ONLY with a validated selector (user-supplied, DNS-label-safe
    `[A-Za-z0-9_-]{1,63}`, or a selector from supported non-secret config —
    no adapter currently yields one, so in practice user-supplied only).
    Query `<selector>._domainkey.<domain>`. Present vs not found. Selector
    omitted/unknown → `DKIM_SELECTOR_UNKNOWN` / NOT_CHECKED. Never guess
    selectors; never declare DKIM missing from an unknown selector. Record
    presence ≠ signature/delivery verification (never claimed).
- **Status vocabulary:** findings carry `confidence` HIGH/MEDIUM/LOW and an
  explicit evidence status in the explanation/evidence (`CONFIRMED` /
  `POTENTIAL` / `INSUFFICIENT_EVIDENCE`), mirroring Tools 02–06. Execution
  status (`COMPLETED` / `PARTIAL` / `FAILED` / `BLOCKED`) is separate from
  findings: missing mail settings on a completed read = COMPLETED with
  findings; a DNS timeout = PARTIAL; a stale snapshot = 422 BLOCKED-style,
  no row.
- **Hard invariants (asserted in tests):** no `wp_mail()` call, no form
  submission, no email send, no SMTP connection, no config mutation anywhere
  in the diagnostic flow (verified by code inspection — the flow contains
  no send/submit path at all — plus tests asserting the service never
  invokes an injected send/submit double); absent recognised plugin ≠ no
  forms exist; unknown config ≠ failure; absent SMTP plugin ≠ failure
  (PHP mail or another integration may be used); config present ≠ delivery
  verified (a `DELIVERY_NOT_VERIFIED` LOW finding is attached to every
  COMPLETED report); inferred cause never presented as proven root cause.

## Files to add / change

- `lib/connector/validate-snapshot.js` — v5 keys `contactForms`,
  `mailTransport`, `senderDomain` + validators (v1–v4 untouched).
- `wordpress-plugin/.../includes/class-diagnostics.php` — v5 collectors
  (CF7, WP Mail SMTP, known-slug UNSUPPORTED entries, sender-domain
  comparison inputs); plugin header + constant → 1.4.0; `schemaVersion` 5.
- `lib/contact-email/` — `domain.js` (validation + default-domain rule),
  `dns.js` (bounded TXT checks), `rules.js` (deterministic findings),
  `freshness.js`, `rate-limit.js`, `service.js`, `ai-input.js`,
  `ai-prompt.js`, `ai-validate.js`, `ai.js`.
- `prisma/schema.prisma` + migration
  `20261028001000_init_m11_contact_email` — ContactEmailDiagnostic /
  ContactEmailFinding / ContactEmailAiAnalysis (mirror Tool 06 shapes).
- `app/api/contact-email-diagnostics/` — `route.js` (POST list/create),
  `[id]/route.js`, `[id]/ai-analysis/route.js`.
- `app/tools/contact-email-checker/` — `page.jsx`, `history/page.jsx`,
  `[id]/page.jsx`; `components/ContactEmailCheckerForm.jsx`,
  `components/ContactEmailAiSection.jsx`; nav link in `SiteHeader.jsx`.
- `tests/contact-email-*.test.js` (unit), `tests/contact-email-db.test.js`
  (DB, wired into `scripts/run-db-tests.mjs`), `tests/php-contact-email.test.php`
  (PHP stubs incl. sentinel-secret assertions); `npm test` + `test:e2e`
  extended with a contact-email E2E file.
- `docs/contact-email-checker.md`, README M11 section.

## Explicit exclusions (tested)

No form submissions/entries, visitor names/phones/emails, message bodies,
order/customer records, full page content, arbitrary `wp_options` contents,
full SMTP config objects, secrets, mail logs with personal data, unrelated
tables/files, or broad DB dumps. PHP tests assert the allowlisted snapshot
keys and that sentinel secrets never appear in collector output.
