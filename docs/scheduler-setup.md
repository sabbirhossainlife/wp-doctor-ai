# Activating scheduled monitoring (Milestone 16)

Current status: **NOT OPERATIONAL**. The tick endpoint, atomic
lease-based claiming, incident/recovery detection, and in-app
notifications are implemented and tested, but no external scheduler
invokes the tick endpoint in any environment, and the dev database's
scheduler state is empty (no tick has ever been persisted there).

## What the scheduler must do

Call, every 5 minutes (matching the smallest monitor interval):

```
POST {BETTER_AUTH_URL}/api/monitoring/internal/tick
Header: x-monitoring-tick-secret: {MONITORING_TICK_SECRET}
Body: {} (JSON; optional batchLimit 1–10, default 10)
```

- `MONITORING_TICK_SECRET` is server-only. Never put it in a
  `NEXT_PUBLIC_*` variable, client code, logs, or API responses.
- The endpoint is NOT authenticated as a user: only the secret holder
  can invoke it. A wrong secret → 401; an unset secret → 503
  `SCHEDULER_NOT_CONFIGURED` (and no checks run).
- Each invocation is bounded (max 10 checks), lease-guarded against
  concurrent duplicates, and recovers stale leases as STALE (never as
  fake failures). There is no catch-up burst: missed intervals are
  recorded as gaps and the schedule resumes at a bounded pace.

## Generic setup (host-agnostic)

Use whatever secure scheduler your host provides (cron service,
scheduled job, or an external cron provider). Example shape only —
replace the host, URL, and secret reference with your own; the secret
itself must come from the host's secret store, never from this file:

```
# every 5 minutes, POST the tick endpoint with the secret header
curl -sf -X POST "$APP_URL/api/monitoring/internal/tick" \
  -H "x-monitoring-tick-secret: $MONITORING_TICK_SECRET" \
  -H "Content-Type: application/json" -d '{}'
```

Do NOT claim a scheduler is configured because this file exists, or
because the secret variable is set. Configuration is proven only by
evidence (below).

## Evidence that it is actually operational

1. `POST /api/monitoring/internal/tick` with the correct secret returns
   a tick summary (counts only, no monitor URLs).
2. Authenticated `GET /api/monitoring/health` (or `/api/readiness`)
   shows a recent `lastTickAt` that advances on successive checks.
3. A due monitor gains a persisted `MonitorCheck` row, and an
   unavailable target produces the correct status (FAILURE/DEGRADED per
   `lib/uptime/classify.js`, never an invented outage).
4. Two concurrent tick invocations do not duplicate the same check
   (lease claim is atomic; covered by DB tests).

If `lastTickAt` is null or stale (>2h, the UI's freshness window),
scheduled monitoring is inactive or the scheduler has stopped — the
uptime page says so honestly, and no recurring-monitoring claim may be
made.

## Scheduler outage handling

- Scheduler down for a while, then back: monitors resume without a
  burst; gaps are recorded, not backfilled with fake checks.
- Tick endpoint 503: the secret is unset in the app environment — fix
  the environment, not the scheduler.
- Tick endpoint 401: the scheduler is presenting the wrong secret —
  rotate/compare via the host's secret store; never log the secret
  while debugging.
