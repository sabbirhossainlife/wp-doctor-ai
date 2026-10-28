# Tool 06 — SSL & Redirect Checker (Milestone 10)

Diagnostic only. This tool never changes WordPress settings, hosting,
DNS, or redirect rules, certificate files, server configuration, or
site content. It observes and reports.

## What it checks

For one user-submitted URL (or one of the user's own registered
websites — see below), the check:

1. Validates the target with the existing M2 scanner policy
   (WHATWG URL, http/https only, ports 80/443 only, no credentials,
   no single-label/refused-suffix hosts).
2. Resolves ALL DNS answers and rejects the host if ANY answer is
   prohibited (loopback, private, link-local, CGNAT, documentation,
   benchmarking, multicast, reserved; IPv6 only 2000::/3).
3. Connects only to the single validated IP (pinned transport), with
   the original hostname in the Host header, SNI, and hostname
   verification. Every redirect destination is fully revalidated
   before connecting — no second independent DNS lookup ever chooses
   the destination (DNS-rebinding protection), and redirects are
   followed manually, never automatically.
4. For each https hop, captures the TLS handshake result from the
   live socket: verified flag, protocol version, and cipher, plus
   certificate metadata (hostname, issuer, validFrom/validTo, SAN
   list bounded to 20) — but ONLY when the handshake verified. On
   failure, certificate fields are null and the error code is the
   evidence. `rejectUnauthorized` is never disabled in any code path.
5. Records each hop: step, sanitized URL (query + fragment stripped),
   HTTP status only when a response was actually received, destination,
   hostname-changed flag, scheme, TLS result when verified, and
   outcome (`followed` | `rejected` | `blocked` | `terminal`). A hop
   with no HTTP response never invents a status code.

## Execution status vs findings (separate concepts)

- BLOCKED — initial target rejected by the safety policy before any
  connection (persisted report, like Tool 05 blocked preflights).
- COMPLETED — a terminal HTTP response was reached, OR a terminal TLS
  outcome was observed (an expired/untrusted certificate is a
  completed observation, not a failed check), OR a downgrade was
  observed and blocked after at least one successful hop.
- PARTIAL — the chain stopped early (redirect destination rejected,
  loop, max redirects, later-hop network/TLS failure) after ≥1 hop.
- FAILED — initial DNS/connection/timeout failure before any HTTP/TLS
  observation, or an internal error.

## Finding codes + severity

| Code | Severity | Meaning |
| --- | --- | --- |
| TLS_CERT_VALID | LOW | Verified, more than 30 days to expiry |
| TLS_CERT_EXPIRING_SOON | MEDIUM | Verified, 30 days or fewer to expiry (warning threshold; expiring soon ≠ expired) |
| TLS_CERT_EXPIRED | HIGH | Validity period ended |
| TLS_CERT_NOT_YET_VALID | HIGH | Validity period not started |
| TLS_HOSTNAME_MISMATCH | HIGH | Certificate does not cover the hostname |
| TLS_CERT_UNTRUSTED | HIGH | Does not chain to a trusted CA (e.g. self-signed) |
| TLS_HANDSHAKE_FAILED | MEDIUM | Handshake failed before verification |
| TLS_TIMEOUT | MEDIUM | Handshake/connection timed out |
| TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT | MEDIUM | Verification failed without a classifiable error |
| HTTPS_NOT_ENFORCED | MEDIUM | HTTP target never reached HTTPS |
| HTTP_TO_HTTPS_REDIRECT | LOW | HTTP upgraded to HTTPS |
| REDIRECT_CHAIN_OK | LOW | Terminal response reached, no chain problem |
| DOWNGRADE_DETECTED_BLOCKED | HIGH | HTTPS→HTTP hop observed, recorded, NOT followed |
| REDIRECT_LOOP | MEDIUM | Chain revisited a URL |
| MAX_REDIRECTS_REACHED | MEDIUM | More than 5 redirects |
| CROSS_HOST_REDIRECT | LOW | Neutral: hostname changed (common, not malicious on its own) |
| REDIRECT_DESTINATION_REJECTED | MEDIUM | Redirect target rejected by the safety policy |
| NETWORK_OR_TIMEOUT | MEDIUM | Connection/DNS/timeout failure |
| INCOMPLETE_EVIDENCE | MEDIUM | PARTIAL/FAILED report with no other finding (never a pass) |

Cross-host redirects and blocked downgrades are reported with neutral,
evidence-bound wording: a cross-host redirect is never called
malicious, and a blocked downgrade is never claimed to have sent
traffic over HTTP or to prove a compromise.

## Security design

- Reused unchanged: `lib/scanner/url-policy.js`, `ip-policy.js`,
  `dns.js`, `errors.js` (incl. `redactUrlForLog`), `rate-limit.js`
  shape, M4 AI provider + strict `json_schema` validation, and the
  `getCurrentUser` session helper.
- One minimal transport extension (`lib/scanner/transport.js`,
  default off): `pinnedRequest` accepts `captureTls` (returns the
  live socket's verified TLS data) and `ca` (passed to `tls.connect`
  only when an in-process caller supplies it). Production routes
  never supply `ca`, so production always uses the default trusted
  CA store. There is no user-controllable CA override, no global
  trust change, and no committed test CA in production config.
- Test CA policy: fixture CAs exist only in per-run temp dirs
  (tests/ssl-fixtures.js, openssl-generated, removed after the run)
  and are passed as in-process parameters by tests only.
- Ownership: every route checks the session; list/detail queries put
  `userId` in the WHERE clause, so another user's report returns the
  identical 404 as a nonexistent one. When `websiteId` is supplied,
  the server loads the Website row with ownership in the WHERE clause
  and uses ONLY its stored `normalizedUrl`; a client-supplied URL
  alongside it is ignored, and client-supplied findings, certificate
  results, statuses, and owner fields are never read.
- Privacy: query strings and fragments are stripped from every stored
  URL and log; no cookies, Authorization headers, credentials,
  response bodies, internal IPs, stack traces, or secrets are stored
  or returned. Request bodies are bounded (~10 KiB); history paging
  is bounded (pageSize ≤ 100). Rate limit: 20 SSL checks/hour/user
  (in-memory, single-process — same limitation as Tools 02–05).
- AI: explicit trigger only, input built solely from the stored
  diagnostic + finding rows (unverified certificate fields are
  nulled before the prompt), strict `ssl-1` schema validation,
  unknown finding references reject the whole analysis, banned
  claims include cross-host-as-malicious, downgrade-as-compromise,
  and guaranteed-security claims. AI never overwrites deterministic
  rows. Unconfigured AI returns 503 AI_NOT_CONFIGURED; the
  deterministic report stands alone.

## Limits and deployment requirements

- Max redirects 5, per-hop timeout 10 s, DNS timeout 5 s, body cap
  256 KiB (counted then discarded), no retries.
- Local/loopback targets are blocked by design (same as Tool 05);
  wp-dev at http://127.0.0.1:8080 is therefore NOT a valid Tool 06
  target — it is used for fixtures only in the sense that no Tool 06
  check is run against it.
- Production SaaS domain: still unconfirmed (as with Milestones 0–9).
- Browser E2E was NOT RUN (no browser binary in this VM); see the
  manual QA checklist below. HTTP-level E2E (tests/e2e-ssl.test.js)
  runs against a running server on the port matching BETTER_AUTH_URL
  (localhost:3000 in the current .env.local — Better Auth rejects
  sign-ups from any other origin, so E2E_BASE_URL must match it).

## Manual QA checklist (browser steps, controlled test site only)

No external production website was tested in this milestone. To verify
manually, use a controlled site you own (or a staging site) with a
valid certificate, and repeat with a staging site whose certificate
you can rotate:

1. Sign in, open /tools/ssl-redirect-checker, submit
   `https://<your-controlled-site>/` — expect COMPLETED,
   TLS_CERT_VALID (or EXPIRING_SOON within 30 days of expiry),
   REDIRECT_CHAIN_OK, and a chain showing each hop with real statuses.
2. Submit the http:// version of the same site — expect
   HTTP_TO_HTTPS_REDIRECT if it upgrades, or HTTPS_NOT_ENFORCED if
   it stays on HTTP.
3. Submit a URL that redirects to a different hostname you control —
   expect CROSS_HOST_REDIRECT (LOW, neutral wording) and no
   "malicious" language anywhere.
4. Submit `http://127.0.0.1/` — expect BLOCKED with no connection
   attempted and no internal details in the report.
5. Open a report, click "Explain this report" — with AI unconfigured,
   expect the honest "not configured" message and the deterministic
   report unchanged; with AI configured, check the explanation cites
   only findings in the report.
6. Open another account and paste the first account's report URL —
   expect a 404 page (identical to a nonexistent report).
7. Check responsiveness and keyboard navigation on the checker,
   history, and detail pages (no fake progress percentages anywhere).
