# Tool 01 — Website Error Checker (Milestone 3)

Authenticated users only. There is no public or unauthenticated scan
endpoint in this milestone.

## Flow

LOGIN → enter URL → server-side session check → `lib/scans.js`
`createScan()` → Milestone 2 `scanUrl()` → `lib/diagnostics/classify.js`
→ Scan + ScanFinding rows in PostgreSQL → report page / history.

The API routes never call `fetch()` or any other HTTP client. The only
HTTP client in the scan path is the Milestone 2 pinned transport, reached
through `scanUrl`. The scanner dependency is injectable only as a function
parameter of `createScan()` (used by tests); there is no env flag, query
parameter, or production switch that substitutes an unsafe transport.

## Execution status vs diagnostic outcome

These are deliberately different fields:

| Execution status | Meaning |
| --- | --- |
| COMPLETED | The scan ran and produced an observed result (including HTTP 4xx/5xx). |
| FAILED | The scan itself could not complete (DNS, TLS, timeout, …). |
| BLOCKED | The request was rejected by policy before any connection. |

| Diagnostic outcome | Trigger |
| --- | --- |
| REACHABLE | Final HTTP status 2xx. |
| HTTP_ERROR_RESPONSE | Final HTTP status 4xx/5xx. |
| REDIRECT_PROBLEM | Redirect loop, redirect limit, or terminal 3xx without a Location. |
| DNS_FAILURE | Scanner code DNS_FAILURE. |
| TLS_FAILURE | Scanner code TLS_FAILURE. |
| TIMEOUT | Scanner code REQUEST_TIMEOUT. |
| CONNECTION_FAILURE | Scanner code CONNECTION_FAILURE. |
| BLOCKED_BY_SECURITY_POLICY | INVALID_URL, UNSUPPORTED_SCHEME, UNSUPPORTED_PORT, PROHIBITED_DESTINATION. |
| INSUFFICIENT_EVIDENCE | RESPONSE_LIMIT_EXCEEDED, RATE_LIMITED, CONCURRENCY_LIMIT_REACHED, INTERNAL_SCANNER_ERROR. |

A website returning HTTP 500 is a COMPLETED scan with a server-error
finding — never a scanner failure. A timeout is reported as an observed
timeout only; recommendations never claim a root cause the evidence does
not support (never "your hosting server is broken" from a timeout).

## What the scanner does and does not collect

- Collected: final HTTP status, redirect count, redacted chain hops
  (protocol, status, content type, byte count), duration.
- NOT collected, and therefore never claimed in a report: TLS certificate
  details (only a TLS_FAILURE code on failure), DNS answers, internal IPs,
  response bodies, cookies, or auth headers.
- No AI explanation is generated in this milestone.

## Privacy policy

- The query string is part of the HTTP request target (that is how the
  requested URL is fetched) and the fragment is never sent (standard HTTP
  semantics). Neither is ever stored in scan history, reports, or logs:
  only protocol + hostname + path are kept.
- URLs with embedded credentials are rejected before any connection.
- Scan history and report APIs enforce ownership in the database query
  (`where: { id, userId }`); another user's record returns the same 404
  as a nonexistent id. Unauthenticated requests return 401.
- Rate-limit rejections return 429 with a generic message; the
  rate-limited scan row is still persisted so it appears in history.

## Limits inherited from Milestone 2

DNS 5 s, overall request 10 s, max 5 redirects, max body 256 KiB
(counted, discarded), no retries, HTTPS → HTTP downgrades rejected.
Scan API body limit: 10 KiB. History pagination: default 20, max 100.
Scan rate limit (shared in-process limiter): per-user 10/min, per-IP
30/min, 5 concurrent — single-process only, not multi-instance safe.
No trusted client IP is available in this app, so per-IP bucketing is
inactive (`ip: null`); `X-Forwarded-For` is never trusted.

## Limitations (shown on every report)

A public URL check cannot reveal private PHP errors, database problems,
or every plugin conflict. If the cause is still unclear, authorized
diagnostics from the WordPress connector (a later milestone) may be
needed. This tool does not diagnose WordPress internals, WooCommerce,
Elementor, or repair anything.

## Data model

Separate `Scan` + `ScanFinding` tables (not a JSON blob on Scan), chosen
so findings can be filtered and listed by future reporting without
parsing unstructured data. Migration: `20261027110818_init_m3_scans`
(applied to dev and test databases). User delete cascades to scans and
findings. Indexes: `Scan(userId, createdAt)`, `ScanFinding(scanId)`.

## Pages and routes

- Pages: `/tools/error-checker` (scan form), `/tools/error-checker/history`,
  `/tools/error-checker/[id]` (report). Guests redirect to `/login`.
- API: `POST /api/scans` (201, or 429 for rate/concurrency limits),
  `GET /api/scans` (paginated, own scans only),
  `GET /api/scans/[id]` (404 for nonexistent or another user's record).
- Dashboard shows the 5 most recent scans with links; the header shows
  "Error Checker" when signed in. No future tool is linked as operational.
