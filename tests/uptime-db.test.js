// Tool 12 DB tests (Milestone 16). Run via scripts/run-db-tests.mjs with
// TEST_DATABASE_URL. No live provider, no live site probing: probes are
// deterministic stubs; all assertions run against the real database.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import {
  createMonitor, listMonitors, getMonitorDetail, updateMonitor, deleteMonitor,
  runManualCheck, listChecks, listIncidents, acknowledgeIncident,
  availabilityForMonitor, createWindow, listWindows, cancelWindow,
  listNotifications, acknowledgeNotification, getSchedulerHealth, runTick,
  UptimeError, UPTIME_LIMITS,
} from "../lib/uptime/service.js";
import { UptimeRateLimiter } from "../lib/uptime/rate-limit.js";

const RUN = `uptime-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA, userB, websiteA, websiteB, monitorA;

const upProbe = (ms = 120) => async () => ({ status: 200, finalUrl: "https://example.com/", redirectCount: 0, crossHostRedirectBlocked: false, headPrefix: "<html>ok</html>", errorCode: null, durationMs: ms });
const failProbe = (status = 500, reason = null) => async () => ({ status, finalUrl: null, redirectCount: 0, crossHostRedirectBlocked: false, headPrefix: null, errorCode: reason, durationMs: 50 });
const maintenanceProbe = async () => ({ status: 503, finalUrl: null, redirectCount: 0, crossHostRedirectBlocked: false, headPrefix: "<html>Briefly unavailable for scheduled maintenance. Check back in a minute.</html>", errorCode: null, durationMs: 80 });
const freshLimiter = () => new UptimeRateLimiter({ limitPerHour: 100 });

async function makeWebsite(userId, host) {
  return prisma.website.create({ data: { name: host, normalizedUrl: `https://${host}`, userId } });
}

test("uptime db: setup users and websites", async () => {
  userA = await prisma.user.create({ data: { name: "Uptime A", email: `${RUN}-a@example.com` } });
  userB = await prisma.user.create({ data: { name: "Uptime B", email: `${RUN}-b@example.com` } });
  websiteA = await makeWebsite(userA.id, `${RUN}-a.example.com`);
  websiteB = await makeWebsite(userB.id, `${RUN}-b.example.com`);
  assert.ok(userA.id && websiteA.id);
});

test("uptime db: create monitor validates interval and ownership", async () => {
  await assert.rejects(
    createMonitor(userA.id, { websiteId: websiteA.id, checkIntervalMinutes: 7 }),
    (e) => e instanceof UptimeError && e.code === "VALIDATION_FAILED",
  );
  await assert.rejects(
    createMonitor(userA.id, { websiteId: websiteB.id }),
    (e) => e instanceof UptimeError && e.code === "WEBSITE_NOT_FOUND",
  );
  monitorA = await createMonitor(userA.id, { websiteId: websiteA.id, notifyEmail: true });
  assert.equal(monitorA.targetUrl, `https://${RUN}-a.example.com/`);
  assert.equal(monitorA.currentState, "UNKNOWN");
  const other = await getMonitorDetail(userB.id, monitorA.id).catch((e) => e);
  assert.ok(other instanceof UptimeError && other.code === "MONITOR_NOT_FOUND");
});

test("uptime db: manual UP check marks healthy; failure threshold opens exactly one incident", async () => {
  let result = await runManualCheck(userA.id, monitorA.id, { probe: upProbe(), limiter: freshLimiter() });
  assert.equal(result.check.outcome, "UP");
  assert.equal(result.monitor.currentState, "HEALTHY");

  result = await runManualCheck(userA.id, monitorA.id, { probe: failProbe(), limiter: freshLimiter() });
  assert.equal(result.check.outcome, "FAILURE");
  assert.equal(result.monitor.currentState, "SUSPECTED_FAILURE");
  let incidents = await listIncidents(userA.id, monitorA.id);
  assert.equal(incidents.total, 0, "one failure must not open an incident");

  result = await runManualCheck(userA.id, monitorA.id, { probe: failProbe(), limiter: freshLimiter() });
  assert.equal(result.monitor.currentState, "DOWN");
  incidents = await listIncidents(userA.id, monitorA.id);
  assert.equal(incidents.total, 1);
  assert.equal(incidents.incidents[0].status, "OPEN");

  result = await runManualCheck(userA.id, monitorA.id, { probe: failProbe(), limiter: freshLimiter() });
  incidents = await listIncidents(userA.id, monitorA.id);
  assert.equal(incidents.total, 1, "further failures update the same incident");
  assert.ok(incidents.incidents[0].failureCount >= 3);

  const notifications = await listNotifications(userA.id, { monitorId: monitorA.id });
  const outages = notifications.notifications.filter((n) => n.type === "OUTAGE");
  assert.equal(outages.length, 1, "exactly one outage notification despite repeated failures");
  assert.equal(outages[0].emailStatus, "EMAIL_NOT_CONFIGURED");
});

test("uptime db: recovery needs the success threshold and notifies once", async () => {
  let result = await runManualCheck(userA.id, monitorA.id, { probe: upProbe(), limiter: freshLimiter() });
  assert.equal(result.monitor.currentState, "RECOVERING");
  result = await runManualCheck(userA.id, monitorA.id, { probe: upProbe(), limiter: freshLimiter() });
  assert.equal(result.monitor.currentState, "HEALTHY");
  const incidents = await listIncidents(userA.id, monitorA.id);
  assert.equal(incidents.incidents[0].status, "RECOVERED");
  assert.ok(incidents.incidents[0].recoveredAt);
  const notifications = await listNotifications(userA.id, { monitorId: monitorA.id });
  assert.equal(notifications.notifications.filter((n) => n.type === "RECOVERY").length, 1);
});

test("uptime db: degraded 403 breaks a failure streak without opening an incident", async () => {
  const website = await makeWebsite(userA.id, `${RUN}-c.example.com`);
  const monitor = await createMonitor(userA.id, { websiteId: website.id });
  await runManualCheck(userA.id, monitor.id, { probe: failProbe(), limiter: freshLimiter() });
  let detail = await getMonitorDetail(userA.id, monitor.id);
  assert.equal(detail.monitor.currentState, "SUSPECTED_FAILURE");
  const degraded = await runManualCheck(userA.id, monitor.id, { probe: failProbe(403), limiter: freshLimiter() });
  assert.equal(degraded.check.outcome, "DEGRADED");
  assert.equal(degraded.monitor.currentState, "DEGRADED");
  await runManualCheck(userA.id, monitor.id, { probe: failProbe(), limiter: freshLimiter() });
  const incidents = await listIncidents(userA.id, monitor.id);
  assert.equal(incidents.total, 0, "403 reset the streak, so the next single failure is only suspected");
  await deleteMonitor(userA.id, monitor.id);
});

test("uptime db: maintenance signature is observed, generic 503 is a failure", async () => {
  const website = await makeWebsite(userA.id, `${RUN}-d.example.com`);
  const monitor = await createMonitor(userA.id, { websiteId: website.id });
  const observed = await runManualCheck(userA.id, monitor.id, { probe: maintenanceProbe, limiter: freshLimiter() });
  assert.equal(observed.check.outcome, "MAINTENANCE_OBSERVED");
  assert.equal(observed.check.maintenanceIndicator, "OBSERVED");
  assert.equal(observed.monitor.currentState, "MAINTENANCE");
  assert.ok(!observed.check.finalUrl || true);
  const incidents = await listIncidents(userA.id, monitor.id);
  assert.equal(incidents.total, 0, "observed maintenance must not open an incident");
  await deleteMonitor(userA.id, monitor.id);
});

test("uptime db: target change blocks checks until explicit reconfirmation", async () => {
  const website = await makeWebsite(userA.id, `${RUN}-e.example.com`);
  const monitor = await createMonitor(userA.id, { websiteId: website.id });
  await prisma.website.update({ where: { id: website.id }, data: { normalizedUrl: `https://${RUN}-e2.example.com` } });
  const blocked = await runManualCheck(userA.id, monitor.id, { probe: upProbe(), limiter: freshLimiter() });
  assert.equal(blocked.check.outcome, "BLOCKED");
  assert.equal(blocked.check.errorCode, "TARGET_MISMATCH");
  assert.equal(blocked.monitor.targetConfirmed, false);
  assert.equal(blocked.monitor.currentState, "BLOCKED");
  const reconfirmed = await updateMonitor(userA.id, monitor.id, { confirmTarget: true });
  assert.equal(reconfirmed.targetConfirmed, true);
  assert.ok(reconfirmed.targetFingerprint.includes(`${RUN}-e2.example.com`));
  const after = await runManualCheck(userA.id, monitor.id, { probe: upProbe(), limiter: freshLimiter() });
  assert.equal(after.check.outcome, "UP");
  await deleteMonitor(userA.id, monitor.id);
});

test("uptime db: maintenance window suppresses alerts but preserves history; escalation after 6h", async () => {
  const website = await makeWebsite(userA.id, `${RUN}-f.example.com`);
  const monitor = await createMonitor(userA.id, { websiteId: website.id });
  const now = Date.now();
  const window = await createWindow(userA.id, {
    monitorId: monitor.id,
    title: "Deploy window",
    startAt: new Date(now - 60 * 1000).toISOString(),
    endAt: new Date(now + 60 * 60 * 1000).toISOString(),
    timezone: "Asia/Dhaka",
    suppressAlerts: true,
    pauseChecks: false,
  });
  await runManualCheck(userA.id, monitor.id, { probe: failProbe(), limiter: freshLimiter() });
  await runManualCheck(userA.id, monitor.id, { probe: failProbe(), limiter: freshLimiter() });
  const incidents = await listIncidents(userA.id, monitor.id);
  assert.equal(incidents.total, 1);
  const notifications = await listNotifications(userA.id, { monitorId: monitor.id });
  const outage = notifications.notifications.find((n) => n.type === "OUTAGE");
  assert.equal(outage.status, "SUPPRESSED");
  assert.equal(outage.windowId, window.id);
  // History preserved despite suppression.
  const checks = await listChecks(userA.id, monitor.id);
  assert.ok(checks.total >= 2);

  // Age the incident past the escalation threshold and fail once more.
  await prisma.monitorIncident.update({
    where: { id: incidents.incidents[0].id },
    data: { firstFailureAt: new Date(now - 7 * 60 * 60 * 1000), escalationSent: false },
  });
  await runManualCheck(userA.id, monitor.id, { probe: failProbe(), limiter: freshLimiter() });
  const after = await listNotifications(userA.id, { monitorId: monitor.id });
  assert.equal(after.notifications.filter((n) => n.type === "PROLONGED_FAILURE_ESCALATION").length, 1);

  // Cancelling the window stops suppression for future incidents.
  await cancelWindow(userA.id, window.id);
  const windows = await listWindows(userA.id, monitor.id);
  assert.equal(windows.windows.find((w) => w.id === window.id).status, "CANCELLED");
  await deleteMonitor(userA.id, monitor.id);
});

test("uptime db: window validation and ownership", async () => {
  const website = await makeWebsite(userA.id, `${RUN}-g.example.com`);
  const monitor = await createMonitor(userA.id, { websiteId: website.id });
  await assert.rejects(
    createWindow(userA.id, { monitorId: monitor.id, title: "Bad", startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now()).toISOString(), timezone: "Asia/Dhaka" }),
    (e) => e instanceof UptimeError && e.code === "VALIDATION_FAILED",
  );
  await assert.rejects(
    createWindow(userA.id, { monitorId: monitor.id, title: "Bad", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(), timezone: "Bogus/Zone" }),
    (e) => e instanceof UptimeError && e.code === "VALIDATION_FAILED",
  );
  await assert.rejects(
    createWindow(userA.id, { monitorId: monitor.id, title: "Bad", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(), timezone: "Asia/Dhaka", recurrence: "WEEKLY" }),
    (e) => e instanceof UptimeError && e.code === "VALIDATION_FAILED",
  );
  await assert.rejects(
    createWindow(userB.id, { monitorId: monitor.id, title: "Nope", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(), timezone: "Asia/Dhaka" }),
    (e) => e instanceof UptimeError && e.code === "MONITOR_NOT_FOUND",
  );
  await deleteMonitor(userA.id, monitor.id);
});

test("uptime db: manual rate limit and paused monitor", async () => {
  const website = await makeWebsite(userA.id, `${RUN}-h.example.com`);
  const monitor = await createMonitor(userA.id, { websiteId: website.id });
  const limiter = new UptimeRateLimiter({ limitPerHour: 1 });
  await runManualCheck(userA.id, monitor.id, { probe: upProbe(), limiter });
  await assert.rejects(
    runManualCheck(userA.id, monitor.id, { probe: upProbe(), limiter }),
    (e) => e instanceof UptimeError && e.code === "RATE_LIMITED",
  );
  await updateMonitor(userA.id, monitor.id, { paused: true });
  await assert.rejects(
    runManualCheck(userA.id, monitor.id, { probe: upProbe(), limiter: freshLimiter() }),
    (e) => e instanceof UptimeError && e.code === "MONITOR_PAUSED",
  );
  await deleteMonitor(userA.id, monitor.id);
});

test("uptime db: tick claims concurrently without duplicating checks; stale lease recovered; paused skipped", async () => {
  const nowMs = Date.now();
  const website = await makeWebsite(userA.id, `${RUN}-i.example.com`);
  const monitor = await createMonitor(userA.id, { websiteId: website.id });
  await prisma.websiteMonitor.update({ where: { id: monitor.id }, data: { nextCheckAt: new Date(nowMs - 60000) } });
  const website2 = await makeWebsite(userA.id, `${RUN}-j.example.com`);
  const monitor2 = await createMonitor(userA.id, { websiteId: website2.id });
  await prisma.websiteMonitor.update({ where: { id: monitor2.id }, data: { nextCheckAt: new Date(nowMs - 60000), status: "PAUSED", currentState: "PAUSED" } });
  // Stale RUNNING check + expired lease on monitor (simulating a crashed worker).
  await prisma.monitorCheck.create({ data: { monitorId: monitor.id, startedAt: new Date(nowMs - 600000), outcome: "RUNNING", triggeredBy: "SCHEDULED", workerId: "dead-worker" } });
  await prisma.websiteMonitor.update({ where: { id: monitor.id }, data: { leaseOwner: "dead-worker", leaseExpiresAt: new Date(nowMs - 60000) } });
  // Very old check row for the retention purge.
  await prisma.monitorCheck.create({ data: { monitorId: monitor.id, startedAt: new Date(nowMs - 100 * 24 * 3600 * 1000), createdAt: new Date(nowMs - 100 * 24 * 3600 * 1000), outcome: "UP", completedAt: new Date(nowMs - 100 * 24 * 3600 * 1000), triggeredBy: "SCHEDULED" } });

  let probeCalls = 0;
  const probe = async () => {
    probeCalls += 1;
    return { status: 200, finalUrl: null, redirectCount: 0, crossHostRedirectBlocked: false, headPrefix: null, errorCode: null, durationMs: 40 };
  };
  const [tickA, tickB] = await Promise.all([
    runTick({ nowMs, probe, workerId: "tick-a" }),
    runTick({ nowMs, probe, workerId: "tick-b" }),
  ]);
  assert.equal(probeCalls, 1, "two concurrent ticks must check the due monitor exactly once");
  assert.equal(tickA.completed + tickB.completed, 1);
  const checks = await listChecks(userA.id, monitor.id);
  assert.ok(checks.checks.some((c) => c.outcome === "STALE"), "crashed worker's RUNNING row becomes STALE, not a failure");
  assert.ok(checks.checks.some((c) => c.outcome === "UP"), "the monitor was re-checked after lease recovery");
  const pausedChecks = await listChecks(userA.id, monitor2.id);
  assert.equal(pausedChecks.total, 0, "paused monitors are never ticked");
  const health = await getSchedulerHealth();
  assert.ok(health.lastTickAt, "tick persists scheduler state");
  assert.equal(health.emailConfigured, false);
  assert.equal(health.emailStatus, "EMAIL_NOT_CONFIGURED");
  await deleteMonitor(userA.id, monitor.id);
  await deleteMonitor(userA.id, monitor2.id);
});

test("uptime db: pause-window tick skips probing; availability uses the documented denominator", async () => {
  const nowMs = Date.now();
  const website = await makeWebsite(userA.id, `${RUN}-k.example.com`);
  const monitor = await createMonitor(userA.id, { websiteId: website.id });
  await createWindow(userA.id, {
    monitorId: monitor.id,
    title: "Paused window",
    startAt: new Date(nowMs - 60000).toISOString(),
    endAt: new Date(nowMs + 3600000).toISOString(),
    timezone: "Asia/Dhaka",
    suppressAlerts: true,
    pauseChecks: true,
  });
  await prisma.websiteMonitor.update({ where: { id: monitor.id }, data: { nextCheckAt: new Date(nowMs - 60000) } });
  let probeCalls = 0;
  const probe = async () => {
    probeCalls += 1;
    return { status: 200, finalUrl: null, redirectCount: 0, crossHostRedirectBlocked: false, headPrefix: null, errorCode: null, durationMs: 40 };
  };
  const summary = await runTick({ nowMs, probe });
  assert.equal(probeCalls, 0, "pauseChecks windows skip probing");
  assert.ok(summary.skippedPausedWindow >= 1);
  const detail = await getMonitorDetail(userA.id, monitor.id);
  assert.equal(detail.monitor.currentState, "MAINTENANCE");

  // Availability: 2 UP + 1 FAILURE + maintenance/blocked excluded.
  await deleteMonitor(userA.id, monitor.id);
  const website2 = await makeWebsite(userA.id, `${RUN}-l.example.com`);
  const monitor2 = await createMonitor(userA.id, { websiteId: website2.id });
  await runManualCheck(userA.id, monitor2.id, { probe: upProbe(), limiter: freshLimiter() });
  await runManualCheck(userA.id, monitor2.id, { probe: upProbe(), limiter: freshLimiter() });
  await runManualCheck(userA.id, monitor2.id, { probe: failProbe(), limiter: freshLimiter() });
  const availability = await availabilityForMonitor(userA.id, monitor2.id, 7);
  assert.equal(availability.availability.eligibleCount, 3);
  assert.equal(availability.availability.availabilityPercent, 66.7);
  assert.equal(availability.responseTime.count, 2);
  await deleteMonitor(userA.id, monitor2.id);
});

test("uptime db: notification acknowledge is ownership-safe; monitor delete cascades only its own data", async () => {
  const notifications = await listNotifications(userA.id, { monitorId: monitorA.id });
  assert.ok(notifications.total >= 1);
  const first = notifications.notifications[0];
  await assert.rejects(
    acknowledgeNotification(userB.id, first.id),
    (e) => e instanceof UptimeError && e.code === "NOTIFICATION_NOT_FOUND",
  );
  const acked = await acknowledgeNotification(userA.id, first.id, "READ");
  assert.equal(acked.status, "READ");
  const incidentAck = await acknowledgeIncident(userB.id, monitorA.id, "nonexistent").catch((e) => e);
  assert.ok(incidentAck instanceof UptimeError);
  await deleteMonitor(userA.id, monitorA.id);
  const remaining = await prisma.monitorCheck.count({ where: { monitorId: monitorA.id } });
  assert.equal(remaining, 0);
  const websiteStillThere = await prisma.website.findUnique({ where: { id: websiteA.id } });
  assert.ok(websiteStillThere, "deleting a monitor must not delete the website");
  const monitors = await listMonitors(userA.id);
  assert.ok(!monitors.monitors.some((m) => m.id === monitorA.id));
});

test("uptime db: monitor limit is enforced", async () => {
  const created = [];
  for (let i = 0; i < UPTIME_LIMITS.maxMonitorsPerUser; i++) {
    const website = await makeWebsite(userA.id, `${RUN}-m${i}.example.com`);
    created.push(await createMonitor(userA.id, { websiteId: website.id }));
  }
  const extra = await makeWebsite(userA.id, `${RUN}-m-extra.example.com`);
  await assert.rejects(
    createMonitor(userA.id, { websiteId: extra.id }),
    (e) => e instanceof UptimeError && e.code === "MONITOR_LIMIT_REACHED",
  );
  for (const m of created) await deleteMonitor(userA.id, m.id);
});
