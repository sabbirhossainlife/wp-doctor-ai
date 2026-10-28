# Tool 06 — SSL & Redirect Checker — Implementation Plan (Milestone 10)

Diagnostic only. Never changes WordPress settings, hosting/DNS/redirect
rules, certificate files, server config, or site content. Milestones 0–9
are preserved unchanged except for one minimal, backwards-compatible
extension to the M2 transport (below).

## Decision: lib/ssl/ engine on top of the M2 scanner, not a parallel scanner

Reused unchanged from M2 (lib/scanner/):
- `url-policy.js` — WHATWG parse, http/https only, ports 80/443 only, no
  credentials, no single-label/refused-suffix hosts, IPv4 canonicalization.
- `ip-policy.js` — fail-closed classification (loopback, private,
  link-local incl. 169.254.169.254, CGNAT, documentation, benchmarking,
  multicast, reserved rejected; IPv6 only 2000::/3; IPv4-mapped/NAT64
  judged by embedded IPv4).
- `dns.js` — `resolveAndValidate`: ALL A+AAAA answers validated, ANY
  prohibited answer rejects the host, 5 s timeout, deterministic chosen
  address (first public IPv4, else first public IPv6).
- `errors.js` — `ScannerError` + `redactUrlForLog` (protocol + hostname +
  path only; query and fragment never stored or logged).
- Limits — DNS 5000 ms, overall 10000 ms per hop, max redirects 5,
  body 256 KiB counted-then-discarded, no retries, manual redirects only,
  HTTPS→HTTP downgrade rejected, Host header keeps hostname, keepAlive
  false, agent destroyed per request.

One minimal transport extension (lib/scanner/transport.js, default off):
- `pinnedRequest` accepts optional `ca` (passed through to `tls.connect`
  only when explicitly supplied by in-process test code — never from user
  input, never from env, never a global setting) and optional
  `captureTls: true`. When capturing, the result gains `tlsInfo` captured
  on `secureConnect` from the live socket: `verified` (socket.authorized),
  `authorizationError`, `protocol` (`getProtocol()`), `cipher`
  (`getCipher().name`), and `peerCertificate` (`getPeerCertificate(true)`).
  Existing callers are unaffected (no `tlsInfo` field unless requested);
  `rejectUnauthorized` is never disabled in any code path.

New module lib/ssl/ (Tool 06 only):
- `tls-probe.js` — standalone genuine TLS probe (direct `tls.connect` to
  a pinned IP with `servername` = original hostname, default CA store,
  `rejectUnauthorized: true` always). Used directly by the core TLS tests
  and as the error-classification reference. Classification:
  `CERT_HAS_EXPIRED` → TLS_CERT_EXPIRED; `CERT_NOT_YET_VALID` →
  TLS_CERT_NOT_YET_VALID; altname errors → TLS_HOSTNAME_MISMATCH;
  untrusted-chain codes (UNABLE_TO_VERIFY_LEAF_SIGNATURE,
  DEPTH_ZERO_SELF_SIGNED_CERT, SELF_SIGNED_CERT_IN_CHAIN, CERT_UNTRUSTED,
  …) → TLS_CERT_UNTRUSTED; timeout → TLS_TIMEOUT; anything else →
  TLS_HANDSHAKE_FAILED. Certificate metadata (issuer, validFrom/validTo,
  SAN list bounded to 20, protocol, cipher) is recorded ONLY when the
  handshake verified; on failure the fields are null and the error code
  is the evidence (TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT is used only
  when verification failed without a classifiable error).
- `engine.js` — `runSslRedirectCheck(input, deps)`. Per hop: parse with
  `parseScanTarget` (relative Location resolved against the current URL),
  loop detection on the normalized URL, DNS + pin via `resolveAndValidate`
  (or the test-only `testPin` seam, see below), then one `pinnedRequest`
  with `captureTls` for https hops. Every redirect destination is fully
  revalidated before connecting — no second independent DNS lookup ever
  chooses the destination; the validated IP per hop is the connection
  target. HTTPS→HTTP downgrade: the downgrade hop is recorded as
  `blocked` with evidence and is NOT followed (the existing M2 rejection
  behaviour, made visible instead of thrown away). Cross-host redirect is
  recorded neutrally (`hostChanged: true`), never labelled malicious.
  No cookies/Authorization/credentials are ever sent; no response body
  is stored; only status, sanitized URLs, and byte counts are kept.
- `rules.js` — pure finding engine (see finding codes below).
- `service.js` — `createSslRedirectDiagnostic` + list/get helpers,
  `SslError`, `publicFinding`, `sslSummary`. Input choice: URL-only,
  with an OPTIONAL owned-website selector. When `websiteId` is supplied
  the server loads the Website row with ownership in the WHERE clause
  and uses ONLY its stored `normalizedUrl`; any client-supplied URL is
  ignored in that case. Client-supplied findings, cert results, or
  ownership fields are never read. Bounded body (~10 KiB) at the route.
- `rate-limit.js` — per-user in-memory limiter, 20/hour, same shape and
  single-process limitation as Tools 02–05.
- `ai-input.js` / `ai-prompt.js` / `ai-validate.js` (schema `ssl-1`) /
  `ai.js` — mirrors Tool 05: input built ONLY from the stored diagnostic
  + finding rows, strict schema, unknown finding refs rejected, banned
  claims include "cross-host redirect is an attack", "downgrade proves
  compromise", guaranteed-security claims, and invented cert dates.
  AI never overwrites deterministic TLS/redirect observations; 503
  AI_NOT_CONFIGURED when unconfigured (no live key exists).

## Execution status vs findings (kept separate)

- BLOCKED — initial target rejected by policy before any connection
  (persisted, like Tool 05 blocked preflights).
- COMPLETED — a terminal HTTP response was reached, OR a terminal TLS
  outcome was observed (an expired/untrusted cert is a completed
  observation, not a failed check), OR a downgrade was observed and
  blocked after at least one successful hop.
- PARTIAL — the chain stopped early (redirect destination rejected,
  loop, max redirects, later-hop network/TLS failure) after ≥1 hop.
- FAILED — initial DNS/connection/timeout failure before any
  HTTP/TLS observation, or an internal error.

## Finding codes + severity

- TLS_CERT_VALID — LOW (verified, >30 days to expiry).
- TLS_CERT_EXPIRING_SOON — MEDIUM (verified, 0–30 days to expiry;
  the 30-day warning threshold; valid-but-expiring-soon ≠ expired).
- TLS_CERT_EXPIRED / TLS_CERT_NOT_YET_VALID / TLS_HOSTNAME_MISMATCH /
  TLS_CERT_UNTRUSTED — HIGH (cert validation failure).
- TLS_HANDSHAKE_FAILED / TLS_TIMEOUT — MEDIUM.
- TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT — MEDIUM (verification failed
  without a classifiable error, or metadata unobtainable).
- HTTPS_NOT_ENFORCED — MEDIUM (http target never reached https).
- HTTP_TO_HTTPS_REDIRECT — LOW (http upgraded to https).
- REDIRECT_CHAIN_OK — LOW (terminal response reached, no loop/max/
  downgrade/rejection on the way).
- DOWNGRADE_DETECTED_BLOCKED — HIGH (https→http hop observed, blocked).
- REDIRECT_LOOP — MEDIUM; MAX_REDIRECTS_REACHED — MEDIUM.
- CROSS_HOST_REDIRECT — LOW, neutral wording only.
- REDIRECT_DESTINATION_REJECTED — MEDIUM.
- NETWORK_OR_TIMEOUT — MEDIUM; INCOMPLETE_EVIDENCE — MEDIUM (only when
  a PARTIAL/FAILED report would otherwise carry no finding).

Hop outcomes: `followed` | `rejected` (policy) | `blocked`
(downgrade, max redirects, or TLS failure on that hop) | `terminal`.
A hop with no HTTP response never invents a status code.

## Database (Prisma migration 20261027230000_init_m10_ssl)

Note on the folder timestamp: Prisma created the migration as
20261027160940 (UTC clock), which sorts BEFORE the M9 folder
20261027193000, breaking shadow-database replay (the M10 migration
alters a table M9 creates). The folder was renamed to
20261027230000_init_m10_ssl so it sorts after M9, and the test-DB
history row was renamed to match (same file content/checksum). The
migration also drops the stray DEFAULT on speed_ai_analysis.updatedAt
left by the M9 file — @updatedAt is still set by the Prisma client.

- `SslRedirectDiagnostic`: id, userId FK cascade, websiteId FK nullable
  (SetNull on website delete — reports are historical records), 
  sanitizedTargetUrl, executionStatus, summary Json, tlsOutcome Json
  nullable, redirectChain Json, limitations Json, startedAt,
  completedAt. Historical rows immutable on re-scan.
- `SslRedirectFinding`: diagnosticId FK cascade, code, severity, title,
  explanation, evidence Json, recommendation, confidence, limitations.
  (Field names follow the brief; Tool 02–05 findings use
  ruleId/category/description — Tool 06 uses code/explanation, and its
  own AI validator matches its own shape.)
- `SslRedirectAiAnalysis`: 1:1 by diagnosticId unique, regeneration
  overwrites, schemaVersion `ssl-1`, never modifies deterministic rows.
- User + Website back-relations added; nothing else in the schema moves.

## API routes (mirror Tool 05 conventions)

- POST /api/ssl-redirect-diagnostics — auth, bounded body, only
  `url`/`websiteId` read, rate limit, runs engine, persists sanitized
  report, 201 with bounded JSON, safe error shapes (no stack traces).
- GET /api/ssl-redirect-diagnostics — own only, desc, bounded paging
  (pageSize ≤ 100).
- GET /api/ssl-redirect-diagnostics/[id] — ownership in WHERE,
  identical 404 for nonexistent vs another user's.
- GET/POST /api/ssl-redirect-diagnostics/[id]/ai-analysis — explicit
  trigger only, 503 AI_NOT_CONFIGURED when unconfigured.

## UI (mirror Tool 05 pages, Tailwind, no new dependencies)

- /tools/ssl-redirect-checker — title, explanation, URL input, optional
  owned-website selector, real running state (no fake percentages),
  results: execution status, certificate status + expiry when verified,
  ordered redirect chain per hop (step, sanitized URL, status when
  observed, destination, host-changed flag, scheme, TLS result when
  verified, outcome), finding cards, explicit failed/partial/blocked/
  insufficient-evidence states, AI section, history link.
- /tools/ssl-redirect-checker/history + /[id] detail — ownership
  enforced server-side, bounded paging.
- Header link added in components/SiteHeader.jsx.

## Test fixtures + strategy

- openssl IS available (OpenSSL 3.0.13). Fixtures are generated per test
  run in a temp dir (never committed, never in production config):
  a test CA, plus server certs via `openssl ca -startdate/-enddate` for
  expired (2020–2021) and not-yet-valid (2030–2031) cases, a valid cert,
  a mismatched-hostname cert, and a self-signed cert. Test CA is passed
  ONLY as an in-process `tlsCa`/`ca` parameter to the engine/transport
  in tests; production code has no CA override path.
- Core TLS tests (tests/ssl-tls.test.js) use the REAL `tls-probe.js`
  against REAL local TLS servers (ephemeral ports): valid + matching
  hostname, expired, not-yet-valid, hostname mismatch, self-signed/
  untrusted, handshake failure (plain HTTP server on a TLS port),
  TLS timeout (accepting but silent server), SNI/hostname verification
  against a pinned IP (connect to 127.0.0.1 with servername), strict
  production verification (no `rejectUnauthorized: false` string in
  production lib code — asserted by grep in the test), valid-cert
  metadata handling, missing metadata on failed handshake. Mocks are
  NOT used for these core cases.
- Engine tests (tests/ssl-engine.test.js): fake transport + fake
  resolver for redirect logic (multi-hop, loop, max redirects, relative
  Location, malformed target, downgrade detection+prevention, cross-host
  reporting, prohibited redirect destination, HTTP-only, HTTP-response
  vs connection-failure separation, query/fragment redaction, policy
  revalidation per hop). These are labelled plumbing tests; the TLS
  truth comes from ssl-tls + ssl-integration tests.
- Integration tests (tests/ssl-integration.test.js): the REAL engine +
  REAL pinned transport against REAL local servers on ports 80/443
  (the VM runs as root, so standard ports bind). A test-only in-process
  seam `testPin` maps test hostnames (e.g. valid.example.test) to
  127.0.0.1, bypassing ONLY the DNS/IP-policy stage for loopback
  fixtures — the TLS handshake, hostname verification, HTTP exchange,
  and redirect handling are all real. This seam is never set by the
  service or any route; it exists only as an engine dependency passed
  by tests. Without it, the fail-closed IP policy would (correctly)
  block every loopback fixture.
- DB tests (tests/ssl-db.test.js, via scripts/run-db-tests.mjs):
  injected engine, ownership, website ownership, client cert/findings
  ignored, sanitized storage, AI ref validation + 503 path.
- E2E tests (tests/e2e-ssl.test.js, HTTP-level against a running
  server): unauthenticated 401, loopback BLOCKED report, invalid input
  400, list/detail, cross-user 404, AI 503.
- Full regression: lint, unit, test:db, test:e2e (against a running
  server on a test port), build, test:scanner, existing PHP connector
  suites (unchanged). Browser E2E: NOT RUN (no browser binary in VM) —
  documented, never claimed.

## Security helpers reused (existing, not duplicated)

parseScanTarget, resolveAndValidate, classifyAddress, redactUrlForLog,
ScannerError, pinnedRequest, SCANNER_LIMITS, shared AI rate limiter,
M4 OpenAI provider + strict json_schema validation, getCurrentUser
session helper, Prisma ownership-in-WHERE pattern.
