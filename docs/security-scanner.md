# Scanner Security — Milestone 2

Internal library only (`lib/scanner/`). **No HTTP route exposes the scanner
in this milestone** — no public scan form, no scan-history UI, no report UI,
no Tool 01. The scanner is exercised by tests until a later milestone wires
it behind authentication.

## Architecture

```
input URL
  -> url-policy.js   WHATWG parse + normalize, scheme/port/host rules
  -> dns.js          resolve ALL A + AAAA, classify EVERY answer, pick one
  -> transport.js    socket pinned to the chosen IP (subclassed Agent)
  -> scanner.js      manual redirect loop, each hop fully re-validated
  -> errors.js       structured codes, redacted logs (logging.js)
  -> rate-limit.js   per-user + per-IP buckets, bounded concurrency
```

## URL policy

- Absolute `http:` / `https:` only. `file:`, `ftp:`, `gopher:`, `data:`,
  `javascript:`, and every other scheme are rejected.
- Embedded credentials, missing/malformed/relative URLs (initial scans),
  control characters, overlong input (> 2048 chars), invalid hostnames
  (underscores, bad labels), and refused suffixes (`localhost`, `.local`,
  `.internal`, `.lan`, `.home.arpa`, `.onion`) are rejected.
- Single-label hostnames are rejected (they can resolve via local search
  domains). Hostnames are lowercased, one trailing dot stripped, IDNs
  punycoded by the WHATWG parser, IPv4 forms canonicalized by the parser
  (`0x7f000001`, `2130706433`, `127.1` all become `127.0.0.1`).
- Ports: **only 80 for http and 443 for https**, explicit or default. Any
  other port is `UNSUPPORTED_PORT`. This is stricter than M1 website
  registration on purpose; the scanner rule lives in `lib/scanner/` only
  and does not change M1 behavior.
- A hostname is never trusted because it "looks public". Only the DNS +
  IP stages decide.

## IP policy (`ip-policy.js`, no new dependency)

Fail closed: an address is public only if it parses cleanly, is in no
prohibited range, and (IPv6) lies in global unicast space `2000::/3`.

IPv4 rejected: loopback `127/8`, unspecified `0/8`, private `10/8`,
`172.16/12`, `192.168/16`, link-local `169.254/16` (including cloud
metadata `169.254.169.254`), CGNAT `100.64/10`, documentation
`192.0.2/24`, `198.51.100/24`, `203.0.113/24`, benchmarking `198.18/15`,
IETF assignments `192.0.0/24`, deprecated 6to4 relay `192.88.99/24`,
multicast `224/4`, reserved `240/4`, invalid forms, leading-zero octets.

IPv6 rejected: loopback `::1`, unspecified `::`, link-local `fe80::/10`,
unique-local `fc00::/7`, multicast `ff00::/8`, discard `100::/64`,
Teredo `2001::/32`, benchmarking `2001:2::/48`, ORCHID `2001:10::/28` and
`2001:20::/28`, documentation `2001:db8::/32` and `3fff::/20`, deprecated
6to4 `2002::/16`, and everything outside `2000::/3`.

IPv4-mapped (`::ffff:a.b.c.d`) and NAT64 well-known (`64:ff9b::a.b.c.d`)
addresses are judged by their embedded IPv4 address: mapped-to-private is
rejected, mapped-to-public is allowed.

## DNS strategy

- `resolveAndValidate` resolves **all** A and AAAA records. **Any**
  prohibited answer rejects the hostname — mixed public+private answers
  are rejected, not "mostly safe".
- Empty results, NXDOMAIN, resolver errors, and timeouts (default 5 s)
  fail as `DNS_FAILURE`. Unexpected address families are rejected.
- IP literals skip DNS (they cannot be rebound) and are classified
  directly.
- The validated set is returned and exactly one address is chosen
  (first public IPv4, else first public IPv6). No other answer is ever
  used as a fallback.

## Connection pinning (DNS rebinding prevention)

Validating DNS and then letting the HTTP client re-resolve is **not**
sufficient — a second answer could be private. The scanner therefore:

1. Resolves once and validates every answer.
2. Creates a **per-request** `http.Agent`/`https.Agent` subclass whose
   `createConnection` connects to the validated IP only, ignoring the
   hostname option it receives.
3. For HTTPS, `tls.connect({ host: pinnedIp, servername: hostname })`:
   SNI carries the original hostname and the certificate is verified
   against that hostname. `rejectUnauthorized` is never disabled.
4. Uses `Host: <hostname>` and `keepAlive: false`; the agent is destroyed
   after the request, so no pooled socket can cross destinations.
5. Never retries and never falls back to another address on failure.

Important Node.js finding (verified on Node 24): passing
`createConnection` as an **Agent constructor option is silently ignored**
— the default connection to the hostname is used instead. The override
must be a subclass method. `tests/scanner-transport.test.js` proves the
subclass path: a request to the unresolvable hostname `example.test`
succeeds against a local server only because the socket goes to the
pinned `127.0.0.1`, with `Host: example.test` observed server-side; a
self-signed server for that hostname is rejected (`TLS_FAILURE`).

## Redirects

Never auto-followed. Each redirect (301, 302, 303, 307, 308; relative or
absolute `Location`) is re-parsed against the current URL, re-normalized,
and put through the full scheme/host/port/DNS/IP/pinning pipeline.
Maximum **5** redirects; loops (revisited normalized URL) and chains
over the limit are `TOO_MANY_REDIRECTS`. **HTTPS → HTTP downgrades are
rejected** (`PROHIBITED_DESTINATION`); HTTP → HTTPS upgrades are allowed.

## Timeouts and resource limits (defaults in `SCANNER_LIMITS`)

| Limit | Default |
|---|---|
| DNS timeout | 5000 ms |
| Overall request timeout | 10000 ms |
| Max redirects | 5 |
| Max response body | 256 KiB (metadata/status only; body is counted and discarded, never retained) |
| Max concurrent scans | 5 (ScanLimiter default) |
| Retries | none |

On timeout, oversize body, or abort, the request/response/socket are
destroyed promptly. Node's default header-size limit applies; an
overflow surfaces as a scanner error, never as a silent accept.

## Rate limiting and concurrency

`ScanLimiter` (per-user 10/min, per-IP 30/min, 5 concurrent, 60 s
windows, FIFO queue capped at 20) with a replaceable store abstraction
(`MapStore` default). Expired buckets are swept lazily on each check so
in-memory state stays bounded. **The in-memory store is single-process
only** and is NOT production-safe across instances — production needs a
shared store (e.g. Redis) behind the same interface. Quota state is never
exposed to other users. Better Auth's own rate limiter is untouched.

## Errors and logging

Structured codes: `INVALID_URL`, `UNSUPPORTED_SCHEME`,
`UNSUPPORTED_PORT`, `PROHIBITED_DESTINATION`, `DNS_FAILURE`,
`CONNECTION_FAILURE`, `TLS_FAILURE`, `REQUEST_TIMEOUT`,
`TOO_MANY_REDIRECTS`, `RESPONSE_LIMIT_EXCEEDED`, `RATE_LIMITED`,
`CONCURRENCY_LIMIT_REACHED`, `INTERNAL_SCANNER_ERROR`. Client-visible
messages are generic; internal detail is server-side only. Log events
carry the hostname only — never query strings, headers, cookies, tokens,
credentials, or resolved IPs. Malformed input throws a `ScannerError`
and cannot crash the process or poison later requests (each scan builds
fresh policy/DNS/agent state).

## What is explicitly NOT built

No scanner route (authenticated or not), no scan form, no scan history,
no report UI, no Tool 01–04, no WordPress connector, no AI, no repair,
no subscriptions/payments, no new database tables, no external services,
no background jobs.

## Test commands

```sh
npm run test:scanner   # scanner groups A–F (91 tests)
npm run test           # full unit suite (M0 + M1 + scanner)
npm run test:db        # database tests (needs local PostgreSQL)
npm run test:e2e       # HTTP E2E against a running dev/prod server
npm run lint
npm run build
```

Security tests use only controlled fixtures (fake resolvers/transports)
and local loopback test servers. They never target real internal
services or dangerous external endpoints, and there is no production
bypass or test-only allowlist in `lib/` — test doubles live in `tests/`.

## Known limitations and production requirements

- Application checks alone do not eliminate all SSRF risk. Production
  must add outbound egress controls (egress proxy / firewall rules that
  deny RFC 1918, link-local, and cloud-metadata destinations) and
  network segmentation for the scanning workers.
- The in-memory rate limiter/concurrency guard is single-process only.
- DNS here uses the system resolver via `node:dns`; a production
  deployment should pin the resolver configuration and consider DNSSEC /
  a trusted recursive resolver. DNS-over-HTTPS is not implemented.
- Response bodies are intentionally not retained; a future feature
  that needs body content must add its own sanitization and size policy
  in a separately approved milestone.
- The scanner does not follow `Refresh` headers, meta refreshes, or
  JavaScript redirects — only HTTP `Location` redirects.

---

# Tool 08 — Security & Vulnerability Scanner (Milestone 12)

This section documents Tool 08 only. The M2 scanner internals above are
unchanged except for one opt-in transport extension (below).

## Provider choice — what was actually verified (2026-10-28)

- **WPVulnerability (active).** Docs at https://docs.wpvulnerability.com/
  (the docs root itself failed to fetch as text in this VM, so endpoint
  shapes were verified from the provider's per-endpoint docs pages and
  from live keyless GETs): core endpoint
  `https://www.wpvulnerability.net/core/{version}/`, plugin endpoint
  `/plugin/{slug}/`, theme endpoint `/theme/{slug}/`. Live GETs run from
  this VM with no key: `/plugin/akismet/` returned `error: 0` with
  advisories carrying `operator` (min/max version + operator, unfixed,
  closed) and `source[]` CVE/WPScan links; `/core/5.8.2/` returned
  version-specific advisories; an unknown slug returned `error: 0` with
  `vulnerability: null`. The project describes its API as "100% open
  and free"; its licensing page asks users to link to WPVulnerability
  and/or the source (attribution is shown in every report) and notes
  EUPL v1.2 work. No published rate limit was found in the docs, so
  this tool imposes its own: 8 s timeout, 512 KiB response cap, 60
  components per scan, concurrency 2, 200 advisories per component.
- **WPScan (not implemented as an active provider).** Its API docs
  (https://wpscan.com/docs/api/v3/) confirm a token is required on every
  request; its free tier is non-commercial only and commercial SaaS use
  requires a paid Enterprise/commercial licence. No token or licence
  exists for this project, so WPScan is documented as
  not-configured/unsupported. Configuring
  `VULNERABILITY_PROVIDER=wpscan` yields PROVIDER_UNAVAILABLE with that
  explanation — never a silent fallback and never a free-tier call
  under a SaaS product.
- **Storage/caching policy.** Only minimal advisory references are
  persisted: advisory uuid, title (≤300 chars), affected range in the
  provider's own representation, fixed version only where derivable
  (max `lt`), CVSS score/severity only when supplied, source ids/links/
  dates only when supplied, retrieval timestamp, provider attribution.
  Full provider responses are never stored, cached beyond the report,
  or redistributed. Reports are the tool's own diagnostics, not a
  redistribution of the provider's database.
- **Env config (server-only; no key exists for the active provider).**
  `VULNERABILITY_PROVIDER` (default `wpvulnerability`; `none` =
  explicitly off; anything else = unsupported → PROVIDER_UNAVAILABLE),
  `VULNERABILITY_PROVIDER_TIMEOUT_MS` (default 8000),
  `VULNERABILITY_MAX_COMPONENTS` (default 60),
  `VULNERABILITY_PROVIDER_CONCURRENCY` (default 2),
  `VULNERABILITY_MAX_RESPONSE_BYTES` (default 512 KiB). Keys are never
  logged or returned in any response, log, or error.

## Adapter architecture

```
snapshot components (core + plugins + theme, server-side only)
  -> lib/security/provider.js   fixed-host fetch, parse, normalize
  -> lib/security/versions.js   standard-version gate + range match
  -> lib/security/rules.js      deterministic findings
  -> lib/security/service.js    orchestration + persistence
```

A future provider implements the same `queryComponent` shape
(productType, key) → `{ advisories, retrievedAt }` and registers under
its own providerId. Base URLs are never user-supplied and never taken
from client input, snapshots, or advisory payloads.

## Version matching — representations supported

- Standard version = `v?\d+(\.\d+)*` exactly (M6 comparator reused).
  Anything else (prerelease, dev, missing, nonstandard) →
  COMPONENT_VERSION_UNKNOWN: never matched, never cleared.
- Plugin/theme operator ranges: `min_version`/`min_operator` in
  {gt, ge}, `max_version`/`max_operator` in {lt, le, eq}; either bound
  may be null. `unfixed: "1"` = no fixed version (still a match if in
  range). Any other operator or unparseable bound →
  INSUFFICIENT_EVIDENCE for that advisory.
- `fixedVersion`: derived ONLY for max `lt`. For `le` the fixed version
  is strictly above the bound and is unknown — never fabricated. For
  `eq` there is no single fixed version. Core: the core endpoint is
  per-version, so a non-empty list for the exact installed version is a
  match; an empty list is NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES.
- Component statuses: MATCHED_ADVISORY, OUTDATED_NO_MATCHING_ADVISORY
  (outdated + no match, expressed as separate findings),
  NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES, COMPONENT_VERSION_UNKNOWN,
  COMPONENT_IDENTITY_UNCERTAIN, PROVIDER_UNAVAILABLE,
  PROVIDER_RATE_LIMITED, PROVIDER_ERROR, INSUFFICIENT_EVIDENCE.

## Connector v6 + backward compatibility

Plugin 1.5.0, schema v6: only addition is `securityIndicators`
(wpDebug, wpDebugDisplay, wpDebugLog, disallowFileEdit, each
yes/no/unknown) from runtime constants via `defined()`. The validator
accepts v1–v6; v1–v5 validate exactly as before. Missing indicators
(pre-v6 snapshots) → INSUFFICIENT_EVIDENCE for hardening checks only.
Theme slug was deliberately NOT added (outside the "only
securityIndicators" scope): theme advisories therefore stay
COMPONENT_IDENTITY_UNCERTAIN. STRICT EXCLUSIONS (asserted in tests):
no users, password hashes, API keys/salts/tokens/private keys, DB
credentials, config files, form submissions, customer/order records,
private posts/pages/media, DB dumps, full server logs, or unnecessary
personal data — in the collector, the validator, or stored reports.

## Passive checks, limits, and the sensitive-path body decision

- All site HTTP goes through M2 pinned components (URL policy, DNS +
  IP policy, pinned transport, rejectUnauthorized never disabled).
  Same-host redirects only, max 3 per check; cross-host redirects stop
  that check and are never followed. Per-scan HTTP cap: 30 requests
  (6 sensitive paths + homepage + xmlrpc + redirect hops).
- **Body-evidence decision (option (a), implemented):** `pinnedRequest`
  gained opt-in `captureBodyBytes` (default 0/off). Only sensitive-path
  probes set it (4 KiB). The service classifies the captured bytes
  immediately against per-path signatures and discards them; persisted
  data is ONLY `{path, status, contentTypeCategory, result, reason}`.
  200 + signature → SENSITIVE_FILE_EXPOSURE_CONFIRMED; 200 without
  signature → SENSITIVE_FILE_POSSIBLE_EXPOSURE; non-200 → NOT_OBSERVED.
  Secret-resembling bodies stop reading, are discarded, and are never
  persisted, logged, shown, or sent to AI. All M2 scanner regression
  tests still pass (91/91).
- Sensitive paths (fixed list, no crawling/enumeration/traversal/port
  scanning): `/.env`, `/.git/HEAD`, `/wp-config.php.bak`,
  `/wp-config.php~`, `/wp-content/debug.log`, `/debug.log`.
- Headers (homepage response only): HSTS, CSP, X-Content-Type-Options,
  X-Frame-Options or effective CSP frame-ancestors, Referrer-Policy,
  Permissions-Policy. Missing → SECURITY_HEADER_MISSING; weak only for
  narrow rules (HSTS max-age < 31536000, X-Content-Type-Options ≠
  nosniff, X-Frame-Options ∉ {DENY, SAMEORIGIN}, CSP wildcard or
  unsafe-inline). A policy differing from one preferred template is
  NOT automatically invalid. Unobservable → SECURITY_CHECK_NOT_RUN.
  No new TLS findings (Tool 06 owns those).
- XML-RPC: unauthenticated GET only, no method calls/auth/payloads.
  200/405 → XMLRPC_ENDPOINT_RESPONDS (informational; disabling is NOT
  auto-recommended). Update status: snapshot cached metadata only.
  Outdated ≠ vulnerable; no auto-install.

## Finding codes + severity rules

WP_CORE_KNOWN_VULNERABILITY / PLUGIN_KNOWN_VULNERABILITY /
THEME_KNOWN_VULNERABILITY (severity from supplied CVSS: ≥9 CRITICAL,
≥7 HIGH, ≥4 MEDIUM, >0 LOW; no supplied score → HIGH, never
downplayed; evidenceStatus POTENTIAL, never proven exploitation),
COMPONENT_OUTDATED (LOW), COMPONENT_VERSION_UNKNOWN (MEDIUM),
VULNERABILITY_PROVIDER_UNAVAILABLE / VULNERABILITY_PROVIDER_RATE_LIMITED
(MEDIUM), WP_DEBUG_DISPLAY_ENABLED (MEDIUM),
DASHBOARD_FILE_EDITING_ENABLED (LOW),
SENSITIVE_FILE_EXPOSURE_CONFIRMED (HIGH),
SENSITIVE_FILE_POSSIBLE_EXPOSURE (MEDIUM), XMLRPC_ENDPOINT_RESPONDS
(LOW), SECURITY_HEADER_MISSING (LOW), SECURITY_HEADER_WEAK_POLICY
(LOW), SECURITY_EVIDENCE_INSUFFICIENT (LOW/MEDIUM by context),
SECURITY_CHECK_NOT_RUN (LOW). Execution status (COMPLETED/PARTIAL) is
separate from findings: provider unavailable or any HTTP check not
running → PARTIAL with explicit limitations, never a clean claim.
`WP_SNAPSHOT_STALE` is not a finding code: stale snapshots block at
422 with no row persisted, mirroring Tools 02–07.

## API routes

`POST /api/security-diagnostics` (authenticated; only `websiteId` is
read; owned website + fresh snapshot required; bounded provider +
HTTP checks; sanitized persisted report), `GET` list (own only, desc,
bounded paging), `GET /[id]` (ownership in WHERE, identical 404),
`POST/GET /[id]/ai-analysis` (explicit trigger; M4 adapter; input =
sanitized bounded evidence only — never secret contents, tokens,
credentials, config, or sensitive bodies; AI validates refs against
stored finding IDs, never changes deterministic results; 503
AI_NOT_CONFIGURED when unconfigured). No unauthenticated endpoints.
No second auth system or AI architecture.

## AI behaviour + 503 status

AI is explanation only (`security-1` schema): it explains supplied
evidence, never invents advisories/CVE/CVSS/fixed versions/headers/
exposures, never claims exploitation/compromise/complete security,
never recommends automatic XML-RPC disabling, never presents an
inferred cause as a proven root cause. Banned claims are rejected by
validation (whole analysis discarded as INVALID_OUTPUT). When AI is
unconfigured, routes return 503 AI_NOT_CONFIGURED and the deterministic
report stands alone. No mock AI content exists in production.

## Privacy / data-minimization safeguards

Server snapshot is the only source of component truth; client data is
ignored/rejected. Stored HTTP data is filtered to six header names +
status + classification only (query/fragment stripped, no full header
set, no bodies). Stored advisory data is minimal references + retrieval
timestamps (see storage policy above). Reports are per-user, immutable,
and paginated. The service contains no login, brute-force,
form-submit, upload, exploit-payload, activation, deactivation,
update, delete, or mutation code path at all.

## Security limitations + false-positive safeguards

- A version match is a potential vulnerability in ONE checked source,
  not proof of exploitation and not a complete assessment.
- No matching advisory ≠ secure; outdated ≠ vulnerable; missing/weak
  header ≠ vulnerability; 200 without signature ≠ confirmed leak;
  403/404 ≠ proof of absence; unknown/prerelease version ≠ safe.
- Theme advisories are not checked by slug (no slug in snapshot).
- Only WPVulnerability is queried; other sources may list more.
- Sensitive-path probes request public paths only; they never submit
  data, authenticate, or exploit anything.
- AI output is labelled interpretation and is validated against
  stored finding IDs; it cannot alter deterministic results.

## Versions / configurations actually tested

- App: Next 15.5, React 19, Prisma 6.14, PostgreSQL (dev + test DBs
  migrated), Node 24. Connector: PHP 8.3.6 CLI stub tests (no phpunit
  in VM); plugin 1.5.0 / schema v6 verified via stub collectors +
  validator tests. wp-dev (WP 7.1.3, PHP 8.3.6) was reachable (HTTP
  200) at implementation time, but its loopback address is BLOCKED by
  the M2 scanner's IP policy by design (as in M10): passive HTTP checks
  against wp-dev report NOT_RUN/PARTIAL, while snapshot + provider
  checks still run. A public test site is needed for a full end-to-end
  passive-HTTP pass.
- Deployment requirements: `VULNERABILITY_PROVIDER` env (default
  `wpvulnerability`); no provider key to provision; connector plugin
  1.5.0 for hardening flags (1.4.0 and earlier still work, with
  hardening reported as insufficient evidence). Production SaaS domain
  still unconfirmed; production AI still NOT_CONFIGURED (503).

## Manual QA checklist (controlled website)

1. Register a public test site, pair connector 1.5.0, sync a fresh
   snapshot (schema v6, indicators visible in the snapshot).
2. Run a scan: expect COMPLETED when provider + HTTP both succeed;
   findings grouped into the seven UI categories; no "100% Secure"
   wording anywhere.
3. With `VULNERABILITY_PROVIDER=none` (staging env only), expect
   PARTIAL + VULNERABILITY_PROVIDER_UNAVAILABLE and no advisory
   findings — never a clean report.
4. With a stale snapshot (>24 h), expect 422 + re-sync instructions
   and no new report row.
5. With another user's websiteId, expect 404 identical to a
   nonexistent id; with a foreign report id, expect 404/not-found.
6. Confirm a sensitive-path CONFIRMED classification stores no body
   text (check the stored `httpObservations` JSON) and that AI
   explanations (when configured) never change finding rows.
7. Confirm the report for a site with no matching advisories says
   "no matching advisory in the checked source" and lists the
   limitations — never "secure" or "clean".
