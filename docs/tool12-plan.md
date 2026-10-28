# Tool 12 Plan — Uptime & Maintenance Monitor (Milestone 16)

Status: plan written before implementation. Milestone 14 remains PARTIAL and
is untouched by this milestone; Milestone 17 is not started.

## What already exists (verified by reading code, not assumed)

- No notification, email-delivery, job-queue, scheduler, or background-worker
  code exists. `.env.example` documents SMTP variables as NOT CONFIGURED and
  lib/auth.js confirms no SMTP provider is configured. Tool 12 therefore
  implements in-app notifications + a durable DB-backed scheduler, and
  reports email as EMAIL_NOT_CONFIGURED (in-app history stays functional).
- No connector-reported maintenance field exists: grep over the connector
  plugin and lib/connector finds no maintenance field in snapshot schema v7.
  Connector-reported maintenance is therefore documented as unavailable;
  observed maintenance detection uses HTTP evidence only (see §5.1).
- Every check goes through the existing M2 components only
  (parseScanTarget, resolveAndValidate, pinnedRequest). No second network
  stack, no unrestricted fetch. Tool 12 adds its own redirect loop on top
  of pinnedRequest (same-host only, max 5, downgrade blocked) because the
  M2 scanUrl helper follows cross-host redirects, which Tool 12 policy
  forbids; the SEO tool (lib/seo/http.js) already establishes this pattern.
- Tool 12 needs no AI. No AI is added (documented, not invented).

## Monitor model

`WebsiteMonitor`: userId, websiteId, targetHost, targetUrl (redacted,
protocol + host + path, no query), targetFingerprint (canonical host +
protocol + port + path), status (ENABLED / PAUSED), targetConfirmed
boolean, targetConfirmedAt, checkIntervalMinutes (5/15/30/60 only),
warningLatencyMs (default 1000), highLatencyMs (default 3000),
failureThreshold (default 2, allowed 1–5), recoveryThreshold (default 2,
allowed 1–5), maintenanceDetectionEnabled (default true),
notifyInApp (default true), notifyEmail (default false),
currentState, consecutiveFailures, consecutiveSuccesses,
firstFailureAt, lastCheckAt, lastSuccessAt, nextCheckAt, leaseOwner,
leaseExpiresAt. Max 20 monitors per user (technical limit, not a billing
entitlement — no plan system exists).

Target-change rule: on every run the monitor's fingerprint is compared
with the owned Website record's current normalized URL. On mismatch the
run is blocked with outcome TARGET_MISMATCH, an in-app notification
`TARGET_RECONFIRMATION_REQUIRED` is created, and checks stay blocked
until the owner explicitly reconfirms (PATCH with confirmTarget: true),
which revalidates and rebinds the fingerprint. Never a silent retarget.

## Classification (lib/uptime/classify.js, pure, deterministic)

Check outcomes: UP, DEGRADED, FAILURE (with failureReason DNS / TLS /
CONNECTION / TIMEOUT / HTTP_5XX), MAINTENANCE_OBSERVED, BLOCKED
(security/configuration: PROHIBITED_DESTINATION, TARGET_MISMATCH, stale
lease handling), REDIRECT_BLOCKED (cross-host redirect not followed),
UNKNOWN (infrastructure/internal failure — never reported as a site outage).

Status rules: 2xx → UP (latency ≥ highLatencyMs → DEGRADED with a
latency flag; warning threshold is recorded, not a status change). 401/403
→ DEGRADED ACCESS_RESTRICTED (responds; not downtime). 404 and other 4xx
→ DEGRADED (reachable; not downtime). 429 → DEGRADED RATE_LIMITED, never
retried aggressively. 5xx → FAILURE HTTP_5XX, except 503 + recognised
maintenance signature → MAINTENANCE_OBSERVED. Redirect loop / redirect
limit → DEGRADED (server behaviour, not downtime). Transport failure with
no HTTP response is never recorded as a successful high-latency response.
Latency is measured with performance.now() (monotonic) plus wall-clock
start/completion timestamps; total response time is never labelled TTFB.

## Incident state machine (service-owned, persisted)

Monitor states: HEALTHY, SUSPECTED_FAILURE, DOWN, RECOVERING,
MAINTENANCE, UNKNOWN, PAUSED, BLOCKED. First qualifying failure →
SUSPECTED_FAILURE (no incident, no notification). Reaching
failureThreshold consecutive failures → one MonitorIncident (status OPEN),
firstFailureAt kept from the first failure, confirmedAt set at threshold,
one outage notification (dedup key incidentId:OUTAGE). Further failures
update the same incident (failureCount, lastFailureAt) — never a new
incident, never a repeated outage notification. One UP check during an
open incident → RECOVERING; reaching recoveryThreshold consecutive UP
checks → incident RECOVERED, recoveredAt recorded, one recovery
notification (dedup key incidentId:RECOVERY). DEGRADED (responding)
checks break a failure streak but do not count toward recovery.
MAINTENANCE_OBSERVED checks neither fail nor recover an incident.
BLOCKED/UNKNOWN checks never open or close incidents. Downtime duration
is reported as observed (confirmedAt → recoveredAt) or as an estimate
between last observed success and first observed failure — never as an
exact outage window.

## Maintenance detection

5.1 Observed indicators (HTTP evidence only): HTTP 503 AND the bounded
first-8-KiB response prefix containing (case-insensitive) "briefly
unavailable for scheduled maintenance" — the standard WordPress
maintenance-page phrase. Prefix only; the body is classified and
discarded, never stored. A generic 503 without the phrase is a 5xx
failure, not maintenance. Insufficient evidence → UNKNOWN /
INSUFFICIENT_EVIDENCE. No DB queries or site-modifying actions are used
to establish maintenance status. A detected maintenance page never
creates or approves a schedule.
5.2 Scheduled windows: one-time only (recurrence is NOT implemented —
never guessed). Fields: title, startAt, endAt (stored UTC), timezone
(IANA identifier validated via Intl.DateTimeFormat), description,
suppressAlerts (default true), pauseChecks (default false: checks keep
recording unless the user opts to pause them). End must be after start;
max duration 14 days. Cancelled windows never suppress future incidents.
5.3 Suppression: during an active window with suppressAlerts, outage /
recovery notifications are recorded as SUPPRESSED with the window id;
check and incident history are preserved. Prolonged-failure policy: if a
DOWN incident stays open for more than 6 hours inside a window, one
escalation in-app notification is created (not suppressed) so a critical
prolonged failure is never silently ignored. After the window ends,
normal evaluation resumes.

## Durable scheduler (lib/uptime/scheduler.js + service tick)

No setInterval or in-memory queue as the scheduling mechanism. State
lives in PostgreSQL: WebsiteMonitor.nextCheckAt + leaseOwner /
leaseExpiresAt, MonitorCheck rows created before probing, and a
singleton MonitoringSchedulerState row (lastTickAt, lastTickSummary).
Tick flow: (1) mark stale RUNNING checks whose lease expired as STALE
(infrastructure outcome, not a site failure); (2) purge check rows older
than 90 days in batches of 500; (3) claim due monitors in bounded
batches (max 10 per tick) with an atomic conditional update
(leaseExpiresAt IS NULL OR < now) — two concurrent ticks cannot claim
the same monitor; (4) run each claimed check sequentially (bounded
concurrency), persist the result, advance nextCheckAt to now + interval
(no catch-up burst: overdue monitors resume at a bounded pace, and a
monitoring gap is recorded on the check when now − scheduledAt exceeds
2 × interval); (5) update scheduler state. Idempotency: one check row
per claim; retries reuse the claim, never duplicate incidents or
notifications (dedup keys). Trigger: POST /api/monitoring/internal/tick
requires header x-monitoring-tick-secret compared with timingSafeEqual
against server-only MONITORING_TICK_SECRET; if the secret is unset the
route returns 503 SCHEDULER_NOT_CONFIGURED. Operational status is
honest: the UI shows "Scheduled monitoring inactive" unless a tick has
actually run recently; a worker file alone proves nothing. Local dev:
manual run-check + direct tick invocation are available and labelled.

## Notifications

In-app only, baseline events: OUTAGE, RECOVERY, MAINTENANCE_OBSERVED,
WINDOW_STARTING (window starting within 60 minutes, created by tick),
WINDOW_ENDED, MONITOR_PAUSED_OR_BLOCKED, TARGET_RECONFIRMATION_REQUIRED,
SCHEDULER_PROBLEM (stale-lease / tick-gap surfacing is via scheduler
state, not a fabricated outage). Records: monitorId, incidentId,
windowId, type, channel IN_APP, status CREATED / SUPPRESSED / READ /
DISMISSED, dedupKey (unique), title, body (no URLs with query strings,
no bodies, no secrets, no internal IPs), acknowledgedAt. Email: no
provider is configured, so email notifications are recorded as
EMAIL_NOT_CONFIGURED and never claimed sent; no wp_mail() call, no
monitored-site mail configuration is used. No webhooks in this milestone
(no safe allowlist architecture exists yet).

## Availability statistics (lib/uptime/availability.js, pure)

Periods 24h / 7d / 30d over stored checks only. Availability % = UP
checks ÷ (UP + DEGRADED + FAILURE checks) in the period; MAINTENANCE,
BLOCKED, UNKNOWN, and missing/paused periods are excluded from the
denominator and shown separately (maintenance time excluded, labelled;
gaps shown as "no observations"). Response-time average/percentile uses
UP checks only, and only when at least 2 valid observations exist,
otherwise an evidence limitation is shown. Single-location monitoring
only — no multi-region claim. Never a guaranteed-uptime claim.

## API routes (all authenticated, ownership in WHERE, identical 404)

- GET/POST /api/monitors; GET/PATCH/DELETE /api/monitors/[id]
  (PATCH: pause/resume, thresholds, notification prefs, confirmTarget)
- POST /api/monitors/[id]/run-check (owner, rate-limited, lease-guarded)
- GET /api/monitors/[id]/checks (paginated), GET /api/monitors/[id]/incidents
- GET/PATCH /api/monitors/[id]/incidents/[incidentId] (acknowledge)
- GET/POST /api/maintenance-windows; GET/PATCH/DELETE /api/maintenance-windows/[id]
- GET/PATCH /api/notifications; PATCH /api/notifications/[id] (acknowledge/dismiss)
- POST /api/monitoring/internal/tick (secret-gated, see above)
- GET /api/monitoring/health (authenticated: schedulerConfigured boolean
  = secret set, lastTickAt, emailConfigured false, counts — no secrets)

## UI

/app/tools/uptime-monitor/page.jsx (overview: counts, scheduler-status
banner, create form, monitor list), /app/tools/uptime-monitor/[id]/page.jsx
(detail: state + reason, last/last-success check, recent checks, incident
timeline, windows, notifications, manual-check button). Header link added
to components/SiteHeader.jsx. Client forms: components/UptimeMonitorForm.jsx,
components/MaintenanceWindowForm.jsx. Non-color status indicators,
keyboard-accessible, responsive, honest empty states. No live-percentage
animation, no fabricated continuity.

## Retention

MonitorCheck rows purged after 90 days (bounded batches at tick time,
never rows needed by an open incident's own timestamps — incidents keep
their own timestamps). Incidents are kept until recovered + acknowledged
policy: open incidents are never purged; recovered incidents are kept.
Pausing a monitor never deletes history. Deleting a monitor cascades its
checks, incidents, windows, and notifications only (never website or
diagnostic data).

## Tests (all executed, never fabricated)

Unit: classification matrix, maintenance signature + generic-503
distinction, window validation/timezone/DST, availability denominator +
gap handling, tick-claim concurrency (two ticks, one claim), incident
thresholds + dedup, target-mismatch blocking. DB: ownership, CRUD,
manual check persistence, scheduler tick with stub probe, stale-lease
recovery, retention purge, cross-user 404, window suppression +
escalation, email-not-configured behaviour. E2E (HTTP, running server):
unauth 401, monitor CRUD, loopback website → BLOCKED check (truthful),
tick unauthorised rejection, tick without secret → 503. Scanner
regression suite re-run (no scanner code changes expected). Browser E2E:
NOT RUN (no binary in VM) — documented, not faked. Live wp-dev
integration: NOT RUN (wp-dev down at verification, watchdog-owned) —
fixtures + a controlled local HTTP server are used instead.

## Explicitly NOT implemented / blocked

- Recurring maintenance windows; multi-region monitoring; webhooks;
  email delivery (no provider); live restore/migration execution (M14
  stays PARTIAL); any arbitrary-URL monitoring (monitors bind to owned
  registered websites only); any change to connector 1.7.0 / snapshot v7;
  any edit to past migrations; any framework/dependency upgrade.
