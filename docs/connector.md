# WP Doctor AI Connector (Milestone 5)

Secure, read-only diagnostics bridge between a WordPress site and the
WP Doctor AI SaaS. The connector never executes remote commands, edits
files, deactivates plugins, changes themes, or modifies settings.

## Architecture

```
WordPress admin (manage_options only)
  -> one-time pairing code (10 min, hashed, single-use)
  -> SaaS POST /api/connector/pair  (returns a connector credential ONCE)
  -> plugin stores the credential (option, autoload disabled)
  -> admin-triggered snapshot POST /api/connector/diagnostics
     (Bearer credential + timestamp + per-request nonce)
  -> SaaS stores the latest snapshot only; dashboard shows it
```

The SaaS never calls into WordPress and never fetches or scans the
supplied site URL during pairing — identity is compared from strings
only, so pairing introduces no new SSRF path.

## Pairing lifecycle

1. SaaS owner opens a website detail page and generates a pairing code
   (`POST /api/connector/pairing-intents`, session + ownership checked,
   max 5 intents per website per hour, in-memory limiter).
2. The code is 160 bits of entropy (32 base32 characters), returned
   ONCE, and stored only as a SHA-256 hash. Older pending intents for
   the same website are revoked when a new code is created.
3. The plugin admin (capability `manage_options`, nonce, explicit
   consent checkbox) submits the code plus `home_url()` / `site_url()`
   and the plugin version to `POST /api/connector/pair`.
4. The SaaS checks: code hash found, status PENDING, not expired
   (10 minutes), fewer than 5 failed attempts, and site identity
   (below). Consumption is atomic: the status transition succeeds
   only while the intent is still PENDING, so two concurrent requests
   cannot both pair with one code.
5. On success the SaaS creates/refreshes a `WebsiteConnection` with a
   fresh 256-bit credential (stored only as a SHA-256 hash), returns
   the credential ONCE, and sets `Website.connectionStatus = CONNECTED`.
6. Failed attempts increment `attemptCount`; expired codes are marked
   EXPIRED; reused codes return `PAIRING_CODE_ALREADY_USED`.

## Site-identity canonicalization

Lowercase host, strip trailing slashes, strip default ports, drop
query strings and fragments, reject embedded credentials and
non-http(s) schemes. Pairing (and snapshot storage) succeeds iff the
registered `Website.normalizedUrl` equals the canonical claimed home
URL **or** the canonical claimed site URL. This handles subdirectory
installs (home != site) without treating the two as interchangeable
elsewhere. Mismatches return `SITE_IDENTITY_MISMATCH` with a
non-sensitive remediation message.

## Credential lifecycle

Generate (pairing) -> store (SaaS: hash only; WordPress: option with
autoload disabled, never rendered in HTML or logs) -> use (Bearer
header on snapshot requests only) -> revoke (dashboard Revoke button
sets the connection REVOKED and the website back to NOT_CONNECTED;
old credentials are then rejected) -> replace (re-pairing issues a
fresh credential) -> delete (plugin disconnect clears local options;
uninstall removes plugin-owned options).

## Diagnostic request authentication

Every snapshot request carries:

* `Authorization: Bearer <credential>`
* `X-WPDoctor-Timestamp`: unix seconds, must be within ±300 s
* `X-WPDoctor-Nonce`: random per request, unique per connection
  (database unique constraint, so concurrent replays lose the race;
  entries older than 2x the window are pruned opportunistically)

Plus: body ≤ 64 KiB, strict schema validation, per-connection rate
limit (60/hour, in-memory, single-process only), and a site-identity
recheck against the paired website. Error codes are bounded
(`CONNECTOR_AUTH_FAILED`, `CONNECTOR_REVOKED`,
`REQUEST_TIMESTAMP_INVALID`, `REQUEST_REPLAYED`,
`INVALID_DIAGNOSTIC_PAYLOAD`, `REQUEST_TOO_LARGE`,
`SITE_IDENTITY_MISMATCH`, `RATE_LIMITED`,
`DATABASE_OPERATION_FAILED`); no stack traces, secrets, or raw
payloads are ever returned or logged.

## Snapshot schema (version 1, allowlist only)

`schemaVersion`, `wordpressVersion`, `phpVersion`, `homeUrl`,
`siteUrl`, `pluginVersion`, `activePlugins[]` (`{name, version}`),
`activeTheme` (`{name, version}` or null), `multisite` (boolean),
`locale`. Unknown or prohibited fields reject the whole payload.
Never collected: usernames, emails, passwords, app passwords,
cookies, API keys, database credentials, config files, order or
customer data, post bodies, unrelated option values, raw logs,
private keys. Unavailable fields are reported as null, never invented.

Only the latest snapshot per connection is kept (replace, never
accumulate). Snapshots are sent only on an explicit administrator
action; there is no telemetry or scheduled sync.

## Plugin configuration

The SaaS base URL comes ONLY from the `WP_DOCTOR_AI_API_BASE_URL`
constant in `wp-config.php`. There is no admin field for it.

* Production: https only, no credentials/query/fragment, port none
  or 443. Missing or invalid configuration fails clearly; there is
  no fallback and no invented default.
* Development exception: http is allowed ONLY when
  `WP_DOCTOR_AI_DEV_MODE` is true AND the host is a loopback address
  (localhost, 127.0.0.1, ::1). Refused otherwise.
* The production SaaS domain is **not yet confirmed** and must be
  supplied by the deployment environment; the SaaS never invents one.
* HTTP client: `wp_remote_post()` against the validated base URL
  (see the code comment for why `wp_safe_remote_post()` is not used:
  its 80/443/8080 port allowlist would reject legitimate local dev
  SaaS servers), timeout 15 s, redirects disabled (`redirection =>
  0`) so credentials cannot be forwarded, TLS verification always on.

## Uninstall / disconnect policy

* Disconnect (plugin page): clears local credential and status
  immediately; the site stops sending snapshots. Full server-side
  invalidation still requires Revoke in the SaaS dashboard.
* Deactivation: deletes nothing.
* Uninstall: removes plugin-owned local options only; unrelated
  WordPress data is untouched. If the SaaS was unreachable, uninstall
  does not claim remote revocation — revoke in the dashboard.

## Known limitations / production requirements

* Rate limiters are in-memory (single-process only); production
  needs a shared store behind the same interfaces.
* HTTPS is mandatory in production; the dev http exception must
  never be enabled there.
* The production SaaS domain is unconfirmed (see above).
* No scheduled/background sync, no Tool 02 diagnostics UI, no
  repair actions — the snapshot is infrastructure for future tools.
* Pairing and diagnostics endpoints are intentionally unauthenticated
  by session (code / credential gated); they must run behind HTTPS
  in production and are rate-limited as documented above.
