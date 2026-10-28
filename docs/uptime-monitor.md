# Tool 12 — Uptime & Maintenance Monitor (Milestone 16)

Authenticated, persistent, single-location monitoring for registered
websites only. Plan: `docs/tool12-plan.md`.

## Operational status — read this first

- The durable scheduler model (PostgreSQL `nextCheckAt` + atomic lease
  claims, `RUNNING` rows persisted before probing, stale-lease recovery,
  bounded batches) and the secret-gated tick endpoint are implemented
  and tested (including two concurrent ticks never duplicating a check).
- **Recurring monitoring is NOT operational in any environment here:**
  no external scheduler (cron or equivalent) is configured to call the
  tick endpoint, so no tick has run outside tests. The UI therefore
  shows "Scheduled monitoring inactive: worker not configured" until a
  real tick runs, and manual checks are the only working path until
  deployment configures one. A worker file alone proves nothing;
  `lastTickAt` (via GET /api/monitoring/health) is the evidence.
- Email alerts are NOT operational: no email-delivery provider adapter
  exists. Every email-enabled notification records `EMAIL_NOT_CONFIGURED`
  and no email is ever claimed sent. `wp_mail()` is never called from
  the monitoring engine, and no monitored site's mail configuration is
  used for SaaS notifications.
- No AI is used by this tool. Production AI remains NOT_CONFIGURED
  (503) for the diagnostic tools; Tool 12 has no AI path at all.
- Milestone 14 remains PARTIAL and untouched: live restore/migration
  execution is still BLOCKED. Connector unchanged: plugin 1.7.0,
  snapshot schema v7, no PHP change. No past migration edited.

## Deployment requirements (production)

1. Set a long random server-only `MONITORING_TICK_SECRET` (never in
   client code, logs, or responses).
2. Configure an external scheduler to call
   `POST /api/monitoring/internal/tick` with header
   `x-monitoring-tick-secret: <secret>` at least every 5 minutes
   (matching the smallest monitor interval). The endpoint caps work at
   10 checks per invocation and is safe to call repeatedly; two
   concurrent invocations cannot duplicate a check.
3. Verify via GET /api/monitoring/health (authenticated): a recent
   `lastTickAt` means ticks are actually running. If `lastTickAt` goes
   stale, monitors show monitoring gaps — never a false healthy state.
4. Do NOT rely on ephemeral local filesystem state for scheduling, and
   do NOT use a process-local timer as the scheduler: all scheduling
   state lives in PostgreSQL.
5. Single-process rate limits (manual checks: 30/hour/user) are
   in-memory, like Tools 02–11; a shared store is the production
   replacement if the app ever runs multi-process.

## Intervals and resource limits (technical limits, not billing)

| Limit | Value |
|---|---|
| Check intervals | 5 / 15 / 30 / 60 minutes only (no sub-minute, no arbitrary values) |
| Monitors per user | 20 |
| Checks per tick invocation | 10 |
| Tick lease | 5 minutes (stale leases recovered as STALE) |
| Manual checks | 30/hour/user, lease-guarded against concurrent runs |
| Probe timeout / body cap | 10 s / 256 KiB (M2 limits); head prefix for maintenance classification 8 KiB |
| Redirects | max 5, same-host only |
| Check history retention | 90 days, purged in batches of 500 at tick time |
| Maintenance window max duration | 14 days, one-time only |
| Escalation threshold | DOWN incident open > 6 h inside a suppressing window → one escalation record |

## Classification and incident/recovery rules

Check outcomes: UP, DEGRADED, FAILURE (reason DNS / TLS / CONNECTION /
TIMEOUT / HTTP_5XX), MAINTENANCE_OBSERVED, BLOCKED, UNKNOWN, STALE.
Rules: 2xx → UP (latency ≥ high threshold → DEGRADED; warning threshold
is recorded, not a status change); 401/403 → DEGRADED ACCESS_RESTRICTED;
404/other 4xx → DEGRADED; 429 → DEGRADED RATE_LIMITED (never retried
aggressively); 5xx → FAILURE, except 503 + recognised maintenance
signature → MAINTENANCE_OBSERVED; redirect loop/limit → DEGRADED;
cross-host redirect → DEGRADED with the destination host recorded and
never fetched; https→http downgrade → BLOCKED; policy refusals
(INVALID_URL, UNSUPPORTED_SCHEME, UNSUPPORTED_PORT,
PROHIBITED_DESTINATION) → BLOCKED; target fingerprint mismatch →
BLOCKED + reconfirmation required; infrastructure/internal failures →
UNKNOWN (never an outage, never an incident).

Monitor states: HEALTHY, DEGRADED, SUSPECTED_FAILURE, DOWN, RECOVERING,
MAINTENANCE, UNKNOWN, PAUSED, BLOCKED. First qualifying failure →
SUSPECTED_FAILURE (no incident, no notification). Reaching
failureThreshold consecutive failures (default 2, range 1–5) opens
exactly ONE incident (firstFailureAt from the first failure,
confirmedAt at threshold, one outage notification with dedup key
`<incidentId>:OUTAGE`). Further failures update the same incident.
DEGRADED (responding) checks break a failure streak but do not count
toward recovery. MAINTENANCE_OBSERVED and BLOCKED checks neither open
nor close incidents. Recovery: recoveryThreshold consecutive UP checks
(default 2, range 1–5) → incident RECOVERED, one recovery notification
(dedup `<incidentId>:RECOVERY`); one UP check during an open incident →
RECOVERING. Downtime duration is reported as observed (confirmed →
recovery-detected) or as an estimate between last observed success and
first observed failure — never as an exact outage window.

## Maintenance detection and timezone handling

Observed indicators (HTTP evidence only): HTTP 503 AND the standard
WordPress maintenance-page phrase ("briefly unavailable for scheduled
maintenance", case-insensitive) in the first 8 KiB of the response.
The prefix is classified and discarded — never stored. A generic 503
without the phrase is a 5xx failure. No connector-reported maintenance
field exists in snapshot schema v7 (verified by grep), so none is
consulted or invented. Insufficient evidence → INSUFFICIENT_EVIDENCE.
A detected maintenance page never creates or approves a schedule, and
detection never disables monitoring by itself.

Scheduled windows: one-time only (recurrence rejected, never guessed).
Stored as UTC timestamps plus a validated IANA timezone string
(`Intl.DateTimeFormat` validation; invalid identifiers rejected).
End must be after start; max 14 days. Active = `startAt <= now < endAt`
and status ACTIVE. During an active window with `suppressAlerts`,
outage/recovery notifications are recorded as SUPPRESSED with the
window id; check and incident history are preserved. If `pauseChecks`
is set, the tick skips probing during the window (no fabricated check
row; the gap is visible as missing observations). Cancelled or deleted
windows never suppress future incidents. After a window ends, normal
evaluation resumes; ended windows are marked COMPLETED by the tick.
Prolonged-failure policy: a DOWN incident open for more than 6 hours
inside a suppressing window generates exactly one escalation in-app
record, so a critical prolonged failure is never silently ignored.

## Availability calculation and denominator

Availability % = UP / (UP + DEGRADED + FAILURE) over stored checks in
the selected period (24 h / 7 d / 30 d in the service; the detail page
shows 7 d). MAINTENANCE_OBSERVED, BLOCKED, UNKNOWN, and STALE checks
are excluded from the denominator and reported separately. Paused and
missing periods contribute no checks and are never counted as uptime.
With zero eligible checks the result is null ("no eligible checks"),
never 0% or 100%. Response-time average/percentiles use UP checks only
and require at least 2 observations. All results are single-location
observations; no multi-region claim is made, and no guaranteed-uptime
claim is ever made.

## Notifications and email-provider status

In-app notifications only, with dedup keys and ownership scoping:
OUTAGE, RECOVERY, MAINTENANCE_OBSERVED (once per day per monitor),
TARGET_RECONFIRMATION_REQUIRED (once per day per monitor),
WINDOW_STARTING (within 60 minutes of start), WINDOW_ENDED,
PROLONGED_FAILURE_ESCALATION. Notification bodies contain no URLs with
query strings, no response bodies, no secrets, and no internal IPs.
Email: `EMAIL_NOT_CONFIGURED` always (see `lib/uptime/email.js`); a
monitor with email alerts enabled still creates its in-app record with
`emailStatus: "EMAIL_NOT_CONFIGURED"`. No webhooks are implemented in
this milestone (no safe allowlist architecture exists yet).

## Security and privacy limitations

- No arbitrary-URL monitoring: monitors bind to owned Website rows;
  client-submitted URLs, statuses, latencies, and incident states are
  ignored or rejected. Cross-user access returns identical 404s.
- Every probe revalidates its destination through the M2 scanner on
  every run; a previously safe DNS result never authorises a future
  request. Connection pinning, manual redirects with per-hop
  revalidation, timeouts, and body caps all apply.
- Never stored: response bodies, HTML snippets, cookies, auth headers,
  internal IPs, full query strings, credentials, or provider secrets.
  Stored final URLs are redacted (protocol + host + path).
- A registered website that the scanner correctly BLOCKS (private or
  prohibited destination) yields a BLOCKED check — the scanner is never
  weakened to make a monitor work.
- Target identity: canonical host + protocol + port + path. On
  mismatch, checks block and the owner must explicitly reconfirm
  (PATCH with `confirmTarget: true`); reconfirmation rebinds the
  fingerprint, and the next check still runs full scanner validation.
- Scheduler secret: constant-time comparison, never logged, never
  returned, never in client code. Tick responses contain only bounded
  aggregate counts — no monitor URLs, no secrets.
- Single-process in-memory rate limits (documented, as in Tools 02–11).
- Reachability ≠ application health: HTTP 200 does not prove
  WordPress, WooCommerce, or Elementor function correctly, and a
  timeout is evidence of a failed check from this location only.

## API summary

- `GET/POST /api/monitors`, `GET/PATCH/DELETE /api/monitors/[id]`
  (PATCH: pause/resume, thresholds, notification prefs, confirmTarget)
- `POST /api/monitors/[id]/run-check` (owner, rate-limited, lease-guarded)
- `GET /api/monitors/[id]/checks`, `GET /api/monitors/[id]/incidents`,
  `PATCH /api/monitors/[id]/incidents/[incidentId]` (acknowledge)
- `GET/POST /api/maintenance-windows`,
  `GET/PATCH/DELETE /api/maintenance-windows/[id]` (PATCH only cancels)
- `GET /api/notifications`, `PATCH /api/notifications/[id]` (read/dismiss)
- `POST /api/monitoring/internal/tick` (secret-gated, see above)
- `GET /api/monitoring/health` (authenticated scheduler/email status)

## Manual QA checklist (controlled website)

1. Register a website you control; create a monitor (15 min, defaults).
   Confirm the monitor shows UNKNOWN until its first check.
2. Run a manual check while the site is up: expect UP/HEALTHY with a
   plausible latency in ms (never labelled TTFB).
3. Make the site return 503 with the standard WordPress maintenance
   page: expect MAINTENANCE_OBSERVED and monitor state MAINTENANCE, no
   incident. Then return a generic 503: expect FAILURE, then a second
   generic 503 opens exactly ONE incident.
4. Return 403 and 404: expect DEGRADED, no incident, and a broken
   failure streak.
5. Point the site at a cross-host redirect: expect the check to stop
   with the destination host recorded and the destination never fetched.
6. Change the registered website URL: expect the next check BLOCKED
   with TARGET_MISMATCH and a reconfirmation notification; reconfirm
   and confirm checks resume against the new target.
7. Create a one-time maintenance window covering now with suppression:
   fail the site twice and confirm the incident exists but its outage
   notification is SUPPRESSED with the window id; cancel the window and
   confirm later alerts are not suppressed.
8. Pause the monitor and confirm the tick skips it and manual checks
   return 409; resume and confirm checks resume.
9. Call the tick endpoint without the secret (expect 401) and with no
   secret configured (expect 503 SCHEDULER_NOT_CONFIGURED); with the
   secret, confirm two concurrent ticks check each due monitor once.
10. Confirm the overview banner reports scheduled monitoring inactive
    until a real tick runs, and that no email is ever claimed sent
    (notifications show EMAIL_NOT_CONFIGURED).

## Tests actually run (Milestone 16)

- Unit 496/496 (25 Tool 12 pure tests: classification matrix,
  maintenance signature vs generic 503, window/timezone validation,
  availability denominator, probe redirect/cross-host/loop/downgrade
  logic, tick-secret validation).
- Scanner regression 91/91 (no scanner code changed).
- DB 143/143 (14 Tool 12 tests: ownership, thresholds, single-incident
  rule, recovery, degraded streak reset, maintenance, target mismatch +
  reconfirmation, window suppression + 6 h escalation, window
  validation/ownership, rate limit + pause, concurrent-tick claim
  safety, stale-lease recovery, pause-window skip, availability,
  notification ownership, delete cascade, monitor limit).
- HTTP E2E 6/6 (production build; loopback target truthfully BLOCKED).
- PHP suites green (connector 42, conflict 22, contact-email 17,
  elementor 16, woocommerce 13, woocommerce-no-wc 9, devmode 5,
  backup/malware/security suites pass).
- Lint clean, production build green.
- NOT RUN: browser E2E (no binary in VM); live wp-dev integration
  (wp-dev down at verification, watchdog-owned); live email delivery
  (no provider); multi-region checks (not implemented).
