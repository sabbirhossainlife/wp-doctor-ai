// Tool 12 service (Milestone 16). Authenticated, ownership-enforced
// monitoring for registered websites ONLY.
//
// Hard rules enforced here, not in the UI:
// - The target URL comes ONLY from the owned Website record. Client
//   input never supplies a URL, a status, a latency, or an incident
//   state; there is no arbitrary-URL monitoring path at all.
// - A fingerprint mismatch between the monitor and the Website record
//   BLOCKS checks and requires explicit owner reconfirmation — an
//   existing monitor is never silently retargeted.
// - Every check (scheduled or manual) goes through the M2 pinned probe
//   (lib/uptime/http.js). Response bodies / HTML prefixes are classified
//   and discarded, never stored.
// - Incidents follow a deterministic state machine: first failure =
//   SUSPECTED (no incident, no alert); failureThreshold consecutive
//   failures = ONE incident; further failures update it; recovery
//   requires recoveryThreshold consecutive UP checks. Infrastructure
//   failures (UNKNOWN / STALE / BLOCKED) never open or close incidents.
// - Notifications are in-app records with dedup keys. Email is
//   EMAIL_NOT_CONFIGURED (see lib/uptime/email.js) and is never claimed
//   sent. Suppressed notifications during an active maintenance window
//   are recorded as SUPPRESSED with the window id — except the 6-hour
//   prolonged-failure escalation, which is always recorded.
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma.js";
import { redactUrlForLog } from "../scanner/errors.js";
import { classifyCheck } from "./classify.js";
import { detectMaintenance, validateWindowInput, findActiveWindow } from "./maintenance.js";
import { computeAvailability, responseTimeStats } from "./availability.js";
import { probeTarget } from "./http.js";
import { sharedUptimeLimiter } from "./rate-limit.js";
import { getEmailStatus } from "./email.js";

export const UPTIME_LIMITS = Object.freeze({
  intervalsMinutes: [5, 15, 30, 60],
  maxMonitorsPerUser: 20,
  maxChecksPerTick: 10,
  leaseMs: 5 * 60 * 1000,
  retentionDays: 90,
  purgeBatch: 500,
  escalationAfterMs: 6 * 60 * 60 * 1000,
  windowStartingNoticeMs: 60 * 60 * 1000,
});

export class UptimeError extends Error {
  constructor(code, status, payload = {}) {
    super(code);
    this.name = "UptimeError";
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

export function targetFingerprint(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export function publicMonitor(row) {
  if (!row) return null;
  return {
    id: row.id,
    websiteId: row.websiteId,
    targetHost: row.targetHost,
    targetUrl: row.targetUrl,
    targetFingerprint: row.targetFingerprint,
    targetConfirmed: row.targetConfirmed,
    targetConfirmedAt: row.targetConfirmedAt ? row.targetConfirmedAt.toISOString() : null,
    status: row.status,
    checkIntervalMinutes: row.checkIntervalMinutes,
    warningLatencyMs: row.warningLatencyMs,
    highLatencyMs: row.highLatencyMs,
    failureThreshold: row.failureThreshold,
    recoveryThreshold: row.recoveryThreshold,
    maintenanceDetectionEnabled: row.maintenanceDetectionEnabled,
    notifyInApp: row.notifyInApp,
    notifyEmail: row.notifyEmail,
    currentState: row.currentState,
    consecutiveFailures: row.consecutiveFailures,
    consecutiveSuccesses: row.consecutiveSuccesses,
    firstFailureAt: row.firstFailureAt ? row.firstFailureAt.toISOString() : null,
    lastCheckAt: row.lastCheckAt ? row.lastCheckAt.toISOString() : null,
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
    nextCheckAt: row.nextCheckAt ? row.nextCheckAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export function publicCheck(row) {
  if (!row) return null;
  return {
    id: row.id,
    monitorId: row.monitorId,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    outcome: row.outcome,
    failureReason: row.failureReason,
    httpStatus: row.httpStatus,
    latencyMs: row.latencyMs,
    latencyWarning: row.latencyWarning,
    finalUrl: row.finalUrl,
    redirectCount: row.redirectCount,
    crossHostRedirectBlocked: row.crossHostRedirectBlocked,
    maintenanceIndicator: row.maintenanceIndicator,
    monitoringGap: row.monitoringGap,
    triggeredBy: row.triggeredBy,
    errorCode: row.errorCode,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

export function publicIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    monitorId: row.monitorId,
    type: row.type,
    severity: row.severity,
    status: row.status,
    firstFailureAt: row.firstFailureAt ? row.firstFailureAt.toISOString() : null,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    recoveredAt: row.recoveredAt ? row.recoveredAt.toISOString() : null,
    lastFailureAt: row.lastFailureAt ? row.lastFailureAt.toISOString() : null,
    failureCount: row.failureCount,
    successCount: row.successCount,
    failureReason: row.failureReason,
    escalationSent: row.escalationSent,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

export function publicNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    monitorId: row.monitorId,
    incidentId: row.incidentId,
    windowId: row.windowId,
    type: row.type,
    channel: row.channel,
    status: row.status,
    title: row.title,
    body: row.body,
    emailStatus: row.emailStatus,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

export function publicWindow(row) {
  if (!row) return null;
  return {
    id: row.id,
    monitorId: row.monitorId,
    title: row.title,
    description: row.description,
    startAt: row.startAt ? row.startAt.toISOString() : null,
    endAt: row.endAt ? row.endAt.toISOString() : null,
    timezone: row.timezone,
    suppressAlerts: row.suppressAlerts,
    pauseChecks: row.pauseChecks,
    status: row.status,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

async function getOwnedMonitor(userId, monitorId) {
  if (typeof monitorId !== "string" || !monitorId) return null;
  return prisma.websiteMonitor.findFirst({ where: { id: monitorId, userId } });
}

function validateMonitorConfig(input = {}) {
  const errors = {};
  if (input.checkIntervalMinutes !== undefined && !UPTIME_LIMITS.intervalsMinutes.includes(input.checkIntervalMinutes)) {
    errors.checkIntervalMinutes = "Interval must be one of 5, 15, 30, or 60 minutes.";
  }
  const warning = input.warningLatencyMs ?? 1000;
  const high = input.highLatencyMs ?? 3000;
  if (!Number.isInteger(warning) || warning < 100 || warning > 30000) errors.warningLatencyMs = "Warning latency must be an integer between 100 and 30000 ms.";
  if (!Number.isInteger(high) || high <= warning || high > 60000) errors.highLatencyMs = "High latency must be an integer above the warning threshold and at most 60000 ms.";
  if (input.failureThreshold !== undefined && (!Number.isInteger(input.failureThreshold) || input.failureThreshold < 1 || input.failureThreshold > 5)) {
    errors.failureThreshold = "Failure threshold must be an integer between 1 and 5.";
  }
  if (input.recoveryThreshold !== undefined && (!Number.isInteger(input.recoveryThreshold) || input.recoveryThreshold < 1 || input.recoveryThreshold > 5)) {
    errors.recoveryThreshold = "Recovery threshold must be an integer between 1 and 5.";
  }
  return errors;
}

export async function createMonitor(userId, input, deps = {}) {
  const nowMs = deps.nowMs ?? Date.now();
  const websiteId = typeof input?.websiteId === "string" ? input.websiteId.trim() : "";
  if (!websiteId) throw new UptimeError("VALIDATION_FAILED", 400, { errors: { websiteId: "A registered website is required." } });
  const website = await prisma.website.findFirst({ where: { id: websiteId, userId } });
  if (!website) throw new UptimeError("WEBSITE_NOT_FOUND", 404);
  const count = await prisma.websiteMonitor.count({ where: { userId } });
  if (count >= UPTIME_LIMITS.maxMonitorsPerUser) {
    throw new UptimeError("MONITOR_LIMIT_REACHED", 429, { limit: UPTIME_LIMITS.maxMonitorsPerUser });
  }
  const config = {
    checkIntervalMinutes: input?.checkIntervalMinutes ?? 15,
    warningLatencyMs: input?.warningLatencyMs ?? 1000,
    highLatencyMs: input?.highLatencyMs ?? 3000,
    failureThreshold: input?.failureThreshold ?? 2,
    recoveryThreshold: input?.recoveryThreshold ?? 2,
    maintenanceDetectionEnabled: input?.maintenanceDetectionEnabled ?? true,
    notifyInApp: input?.notifyInApp ?? true,
    notifyEmail: input?.notifyEmail ?? false,
  };
  const errors = validateMonitorConfig(config);
  if (Object.keys(errors).length > 0) throw new UptimeError("VALIDATION_FAILED", 400, { errors });
  const fingerprint = targetFingerprint(website.normalizedUrl);
  if (!fingerprint) throw new UptimeError("VALIDATION_FAILED", 400, { errors: { websiteId: "The registered website URL is not usable as a monitor target." } });
  let host = "";
  try {
    host = new URL(website.normalizedUrl).hostname;
  } catch {
    host = "";
  }
  const row = await prisma.websiteMonitor.create({
    data: {
      userId,
      websiteId: website.id,
      targetHost: host,
      targetUrl: redactUrlForLog(website.normalizedUrl),
      targetFingerprint: fingerprint,
      targetConfirmed: true,
      targetConfirmedAt: new Date(nowMs),
      status: "ENABLED",
      ...config,
      currentState: "UNKNOWN",
      nextCheckAt: new Date(nowMs),
    },
  });
  return publicMonitor(row);
}

export async function listMonitors(userId, { page = 1, pageSize = 20 } = {}) {
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.websiteMonitor.count({ where: { userId } }),
    prisma.websiteMonitor.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return { monitors: rows.map(publicMonitor), total, page, pageSize: take };
}

export async function getMonitorDetail(userId, monitorId) {
  const monitor = await getOwnedMonitor(userId, monitorId);
  if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
  const [checks, incidents, windows, notifications, website] = await Promise.all([
    prisma.monitorCheck.findMany({ where: { monitorId: monitor.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.monitorIncident.findMany({ where: { monitorId: monitor.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.maintenanceWindow.findMany({ where: { monitorId: monitor.id }, orderBy: { startAt: "asc" }, take: 50 }),
    prisma.monitorNotification.findMany({ where: { monitorId: monitor.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.website.findFirst({ where: { id: monitor.websiteId, userId } }),
  ]);
  return {
    monitor: publicMonitor(monitor),
    website: website ? { id: website.id, name: website.name, normalizedUrl: website.normalizedUrl } : null,
    checks: checks.map(publicCheck),
    incidents: incidents.map(publicIncident),
    windows: windows.map(publicWindow),
    notifications: notifications.map(publicNotification),
  };
}

export async function updateMonitor(userId, monitorId, input, deps = {}) {
  const nowMs = deps.nowMs ?? Date.now();
  const monitor = await getOwnedMonitor(userId, monitorId);
  if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
  const data = {};
  if (input?.confirmTarget === true) {
    const website = await prisma.website.findFirst({ where: { id: monitor.websiteId, userId } });
    if (!website) throw new UptimeError("WEBSITE_NOT_FOUND", 404);
    const fingerprint = targetFingerprint(website.normalizedUrl);
    if (!fingerprint) throw new UptimeError("VALIDATION_FAILED", 400, { errors: { websiteId: "The registered website URL is not usable as a monitor target." } });
    // Revalidation note: the next check re-runs the full M2 scanner
    // policy against the new target; reconfirmation only rebinds the
    // fingerprint, it never skips validation.
    let host = "";
    try {
      host = new URL(website.normalizedUrl).hostname;
    } catch {
      host = "";
    }
    data.targetHost = host;
    data.targetUrl = redactUrlForLog(website.normalizedUrl);
    data.targetFingerprint = fingerprint;
    data.targetConfirmed = true;
    data.targetConfirmedAt = new Date(nowMs);
    data.currentState = "UNKNOWN";
    data.consecutiveFailures = 0;
    data.consecutiveSuccesses = 0;
    data.firstFailureAt = null;
    data.nextCheckAt = new Date(nowMs);
  }
  if (typeof input?.paused === "boolean") {
    data.status = input.paused ? "PAUSED" : "ENABLED";
    data.currentState = input.paused ? "PAUSED" : "UNKNOWN";
    if (!input.paused) data.nextCheckAt = new Date(nowMs);
    if (input.paused) {
      data.leaseOwner = null;
      data.leaseExpiresAt = null;
    }
  }
  const configPatch = {};
  for (const key of ["checkIntervalMinutes", "warningLatencyMs", "highLatencyMs", "failureThreshold", "recoveryThreshold"]) {
    if (input?.[key] !== undefined) configPatch[key] = input[key];
  }
  for (const key of ["maintenanceDetectionEnabled", "notifyInApp", "notifyEmail"]) {
    if (typeof input?.[key] === "boolean") configPatch[key] = input[key];
  }
  const merged = {
    checkIntervalMinutes: monitor.checkIntervalMinutes,
    warningLatencyMs: monitor.warningLatencyMs,
    highLatencyMs: monitor.highLatencyMs,
    failureThreshold: monitor.failureThreshold,
    recoveryThreshold: monitor.recoveryThreshold,
    ...configPatch,
  };
  const errors = validateMonitorConfig(merged);
  if (Object.keys(errors).length > 0) throw new UptimeError("VALIDATION_FAILED", 400, { errors });
  Object.assign(data, configPatch);
  if (Object.keys(data).length === 0) throw new UptimeError("VALIDATION_FAILED", 400, { errors: { body: "No updatable field was supplied." } });
  const updated = await prisma.websiteMonitor.update({ where: { id: monitor.id }, data });
  return publicMonitor(updated);
}

export async function deleteMonitor(userId, monitorId) {
  const monitor = await getOwnedMonitor(userId, monitorId);
  if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
  // Cascade deletes checks, incidents, windows, and notifications for
  // THIS monitor only. Website and diagnostic data are untouched.
  await prisma.websiteMonitor.delete({ where: { id: monitor.id } });
  return { deleted: true };
}

async function createNotificationIfAbsent({ monitor, incidentId = null, windowId = null, type, title, body, suppressed = false, suppressWindowId = null, emailStatus = null }) {
  const dedupKey = incidentId
    ? `${incidentId}:${type}`
    : windowId
      ? `${windowId}:${type}`
      : `${monitor.id}:${type}:${new Date().toISOString().slice(0, 10)}`;
  const existing = await prisma.monitorNotification.findUnique({ where: { dedupKey } });
  if (existing) return null;
  const row = await prisma.monitorNotification.create({
    data: {
      monitorId: monitor.id,
      incidentId,
      windowId: suppressWindowId ?? windowId,
      type,
      channel: "IN_APP",
      status: suppressed ? "SUPPRESSED" : "CREATED",
      dedupKey,
      title,
      body,
      emailStatus,
    },
  });
  return row;
}

function dayKey(dateMs) {
  return new Date(dateMs).toISOString().slice(0, 10);
}

async function notify({ monitor, incident, window, type, title, body, nowMs, forceRecord = false }) {
  const activeWindow = window ?? null;
  const suppressed = Boolean(activeWindow && activeWindow.suppressAlerts);
  if (!forceRecord && !monitor.notifyInApp) return null;
  let emailStatus = null;
  if (monitor.notifyEmail) {
    // Email is never attempted when unconfigured; the record says so.
    emailStatus = getEmailStatus().status;
  }
  return createNotificationIfAbsent({
    monitor,
    incidentId: incident ? incident.id : null,
    windowId: window && type.startsWith("WINDOW_") ? window.id : null,
    type,
    title,
    body,
    suppressed,
    suppressWindowId: suppressed && activeWindow ? activeWindow.id : null,
    emailStatus,
  });
}

// Core state-machine application. Returns the monitor update payload;
// incident/notification writes happen here (single place, tested).
async function applyCheckResult(monitor, check, classification, { nowMs, activeWindow }) {
  const now = new Date(nowMs);
  const data = {
    lastCheckAt: now,
    consecutiveFailures: monitor.consecutiveFailures,
    consecutiveSuccesses: monitor.consecutiveSuccesses,
    firstFailureAt: monitor.firstFailureAt,
    lastSuccessAt: monitor.lastSuccessAt,
  };
  let openIncident = await prisma.monitorIncident.findFirst({
    where: { monitorId: monitor.id, status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });
  const outcome = classification.outcome;

  if (outcome === "FAILURE") {
    data.consecutiveFailures = monitor.consecutiveFailures + 1;
    data.consecutiveSuccesses = 0;
    if (!data.firstFailureAt) data.firstFailureAt = check.startedAt;
    if (data.consecutiveFailures >= monitor.failureThreshold) {
      if (!openIncident) {
        openIncident = await prisma.monitorIncident.create({
          data: {
            monitorId: monitor.id,
            type: "DOWN",
            severity: "HIGH",
            status: "OPEN",
            firstFailureAt: data.firstFailureAt,
            confirmedAt: now,
            lastFailureAt: now,
            failureCount: data.consecutiveFailures,
            failureReason: classification.failureReason,
          },
        });
      } else {
        openIncident = await prisma.monitorIncident.update({
          where: { id: openIncident.id },
          data: { lastFailureAt: now, failureCount: data.consecutiveFailures, failureReason: classification.failureReason },
        });
      }
      data.currentState = "DOWN";
      const created = await notify({
        monitor, incident: openIncident, window: activeWindow, nowMs,
        type: "OUTAGE",
        title: "Possible outage detected",
        body: `Monitoring observed repeated failures for this website. This is an observation from a single monitoring location, not proof the site is down worldwide.`,
      });
      void created;
      // Prolonged-failure escalation: a DOWN incident open for more than
      // 6 hours inside a suppressing window still gets ONE escalation
      // record so a critical failure is never silently ignored.
      if (
        activeWindow && activeWindow.suppressAlerts && openIncident &&
        !openIncident.escalationSent &&
        nowMs - new Date(openIncident.firstFailureAt).getTime() > UPTIME_LIMITS.escalationAfterMs
      ) {
        await prisma.monitorIncident.update({ where: { id: openIncident.id }, data: { escalationSent: true } });
        await notify({
          monitor, incident: openIncident, window: activeWindow, nowMs, forceRecord: true,
          type: "PROLONGED_FAILURE_ESCALATION",
          title: "Prolonged outage during maintenance window",
          body: "This website has remained down for more than 6 hours during a scheduled maintenance window. Review the window and the site.",
        });
      }
    } else {
      data.currentState = "SUSPECTED_FAILURE";
    }
  } else if (outcome === "UP") {
    data.consecutiveSuccesses = monitor.consecutiveSuccesses + 1;
    data.consecutiveFailures = 0;
    data.firstFailureAt = null;
    data.lastSuccessAt = now;
    if (openIncident) {
      const successCount = data.consecutiveSuccesses;
      if (successCount >= monitor.recoveryThreshold) {
        openIncident = await prisma.monitorIncident.update({
          where: { id: openIncident.id },
          data: { status: "RECOVERED", recoveredAt: now, successCount },
        });
        data.currentState = activeWindow ? "MAINTENANCE" : "HEALTHY";
        await notify({
          monitor, incident: openIncident, window: activeWindow, nowMs,
          type: "RECOVERY",
          title: "Website recovered",
          body: "Monitoring observed repeated successful checks after a downtime incident. Recovery time is the observed detection time, not the exact moment service returned.",
        });
      } else {
        await prisma.monitorIncident.update({ where: { id: openIncident.id }, data: { successCount } });
        data.currentState = "RECOVERING";
      }
    } else {
      data.currentState = activeWindow ? "MAINTENANCE" : "HEALTHY";
    }
  } else if (outcome === "DEGRADED") {
    // Responding breaks a failure streak but does not count as recovery.
    data.consecutiveFailures = 0;
    data.consecutiveSuccesses = 0;
    data.currentState = openIncident ? "DOWN" : activeWindow ? "MAINTENANCE" : "DEGRADED";
  } else if (outcome === "MAINTENANCE_OBSERVED") {
    data.currentState = openIncident ? "DOWN" : "MAINTENANCE";
    if (monitor.notifyInApp) {
      await createNotificationIfAbsent({
        monitor, type: `MAINTENANCE_OBSERVED:${dayKey(nowMs)}`,
        title: "WordPress maintenance indicator observed",
        body: "The site returned a recognised WordPress maintenance response. This is an observed indicator, not proof of the site's complete internal state.",
        suppressed: Boolean(activeWindow && activeWindow.suppressAlerts),
        suppressWindowId: activeWindow && activeWindow.suppressAlerts ? activeWindow.id : null,
      });
    }
  } else if (outcome === "BLOCKED") {
    data.currentState = openIncident ? "DOWN" : "BLOCKED";
    if (check.errorCode === "TARGET_MISMATCH") {
      data.targetConfirmed = false;
      await createNotificationIfAbsent({
        monitor, type: `TARGET_RECONFIRMATION_REQUIRED:${dayKey(nowMs)}`,
        title: "Monitor target requires reconfirmation",
        body: "The registered website URL changed after this monitor was configured. Checks are blocked until you explicitly reconfirm the new target.",
      });
    }
  } else {
    // UNKNOWN / STALE: infrastructure outcome. Never an outage, never
    // a recovery, counters preserved.
    data.currentState = openIncident ? "DOWN" : "UNKNOWN";
  }
  return data;
}

export async function runCheckForMonitor(monitor, { triggeredBy = "SCHEDULED", probe = null, nowMs = Date.now(), workerId = null, scheduledAt = null } = {}) {
  const now = new Date(nowMs);
  const website = await prisma.website.findFirst({ where: { id: monitor.websiteId, userId: monitor.userId } });
  if (!website) {
    throw new UptimeError("WEBSITE_NOT_FOUND", 404);
  }
  const windows = await prisma.maintenanceWindow.findMany({
    where: { monitorId: monitor.id, status: "ACTIVE" },
    orderBy: { startAt: "asc" },
  });
  const activeWindow = findActiveWindow(windows, nowMs);

  // Placeholder row persisted BEFORE probing, so a crash leaves a
  // visible RUNNING row that stale-lease recovery can resolve — never
  // a fabricated completed check.
  const checkRow = await prisma.monitorCheck.create({
    data: {
      monitorId: monitor.id,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      startedAt: now,
      outcome: "RUNNING",
      triggeredBy,
      workerId,
    },
  });

  let probeResult;
  const fingerprint = targetFingerprint(website.normalizedUrl);
  if (fingerprint !== monitor.targetFingerprint) {
    probeResult = { status: null, finalUrl: null, redirectCount: 0, crossHostRedirectBlocked: false, headPrefix: null, errorCode: "TARGET_MISMATCH", durationMs: 0 };
  } else {
    const probeFn = probe ?? probeTarget;
    try {
      probeResult = await probeFn(website.normalizedUrl, {});
    } catch {
      probeResult = { status: null, finalUrl: null, redirectCount: 0, crossHostRedirectBlocked: false, headPrefix: null, errorCode: "INTERNAL_SCANNER_ERROR", durationMs: 0 };
    }
  }

  const maintenance = detectMaintenance({
    httpStatus: probeResult.status,
    headPrefix: probeResult.headPrefix ?? null,
    enabled: monitor.maintenanceDetectionEnabled,
  });
  const classification = classifyCheck({
    httpStatus: probeResult.status,
    errorCode: probeResult.errorCode,
    latencyMs: probeResult.durationMs,
    maintenanceObserved: maintenance.observed,
    warningLatencyMs: monitor.warningLatencyMs,
    highLatencyMs: monitor.highLatencyMs,
  });
  // A cross-host redirect block arrives as an errorCode here; the
  // classifier maps it to DEGRADED, and the check keeps the flag.
  const monitoringGap =
    Boolean(scheduledAt) && nowMs - new Date(scheduledAt).getTime() > 2 * monitor.checkIntervalMinutes * 60 * 1000;
  const maintenanceIndicator =
    probeResult.errorCode === "TARGET_MISMATCH" ? "NOT_OBSERVED"
    : probeResult.status === null ? "INSUFFICIENT_EVIDENCE"
    : maintenance.indicator;

  const completed = await prisma.monitorCheck.update({
    where: { id: checkRow.id },
    data: {
      completedAt: new Date(nowMs),
      outcome: classification.outcome,
      failureReason: classification.failureReason,
      httpStatus: probeResult.status,
      latencyMs: probeResult.durationMs ?? null,
      latencyWarning: classification.latencyWarning,
      finalUrl: probeResult.finalUrl,
      redirectCount: probeResult.redirectCount ?? 0,
      crossHostRedirectBlocked: probeResult.crossHostRedirectBlocked ?? false,
      maintenanceIndicator,
      monitoringGap,
      errorCode: probeResult.errorCode,
    },
  });

  const freshMonitor = await prisma.websiteMonitor.findUnique({ where: { id: monitor.id } });
  const update = await applyCheckResult(freshMonitor, completed, classification, { nowMs, activeWindow });
  update.nextCheckAt = triggeredBy === "MANUAL"
    ? (freshMonitor.nextCheckAt && new Date(freshMonitor.nextCheckAt).getTime() > nowMs ? freshMonitor.nextCheckAt : new Date(nowMs + freshMonitor.checkIntervalMinutes * 60 * 1000))
    : new Date(nowMs + freshMonitor.checkIntervalMinutes * 60 * 1000);
  update.leaseOwner = null;
  update.leaseExpiresAt = null;
  const updatedMonitor = await prisma.websiteMonitor.update({ where: { id: monitor.id }, data: update });
  return { monitor: publicMonitor(updatedMonitor), check: publicCheck(completed) };
}

export async function runManualCheck(userId, monitorId, deps = {}) {
  const nowMs = deps.nowMs ?? Date.now();
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedUptimeLimiter;
  if (limiter && !limiter.check(userId, nowMs)) {
    throw new UptimeError("RATE_LIMITED", 429);
  }
  const monitor = await getOwnedMonitor(userId, monitorId);
  if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
  if (monitor.status === "PAUSED") throw new UptimeError("MONITOR_PAUSED", 409);
  if (monitor.leaseOwner && monitor.leaseExpiresAt && new Date(monitor.leaseExpiresAt).getTime() > nowMs) {
    throw new UptimeError("CHECK_IN_PROGRESS", 409);
  }
  const workerId = `manual-${randomUUID()}`;
  await prisma.websiteMonitor.update({
    where: { id: monitor.id },
    data: { leaseOwner: workerId, leaseExpiresAt: new Date(nowMs + UPTIME_LIMITS.leaseMs) },
  });
  try {
    return await runCheckForMonitor(monitor, { triggeredBy: "MANUAL", probe: deps.probe ?? null, nowMs, workerId });
  } catch (error) {
    await prisma.websiteMonitor.update({
      where: { id: monitor.id },
      data: { leaseOwner: null, leaseExpiresAt: null },
    }).catch(() => {});
    throw error;
  }
}

export async function listChecks(userId, monitorId, { page = 1, pageSize = 20 } = {}) {
  const monitor = await getOwnedMonitor(userId, monitorId);
  if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.monitorCheck.count({ where: { monitorId: monitor.id } }),
    prisma.monitorCheck.findMany({ where: { monitorId: monitor.id }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return { checks: rows.map(publicCheck), total, page, pageSize: take };
}

export async function listIncidents(userId, monitorId, { page = 1, pageSize = 20 } = {}) {
  const monitor = await getOwnedMonitor(userId, monitorId);
  if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.monitorIncident.count({ where: { monitorId: monitor.id } }),
    prisma.monitorIncident.findMany({ where: { monitorId: monitor.id }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return { incidents: rows.map(publicIncident), total, page, pageSize: take };
}

export async function acknowledgeIncident(userId, monitorId, incidentId) {
  const monitor = await getOwnedMonitor(userId, monitorId);
  if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
  const incident = await prisma.monitorIncident.findFirst({ where: { id: incidentId, monitorId: monitor.id } });
  if (!incident) throw new UptimeError("INCIDENT_NOT_FOUND", 404);
  const updated = await prisma.monitorIncident.update({ where: { id: incident.id }, data: { acknowledgedAt: new Date() } });
  return publicIncident(updated);
}

export async function availabilityForMonitor(userId, monitorId, days = 7) {
  const monitor = await getOwnedMonitor(userId, monitorId);
  if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
  const safeDays = [1, 7, 30].includes(days) ? days : 7;
  const from = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.monitorCheck.findMany({
    where: { monitorId: monitor.id, createdAt: { gte: from }, outcome: { not: "RUNNING" } },
    orderBy: { createdAt: "asc" },
  });
  return {
    days: safeDays,
    availability: computeAvailability(rows),
    responseTime: responseTimeStats(rows),
    checks: rows.map(publicCheck),
  };
}

// --- Maintenance windows ---

export async function createWindow(userId, input, deps = {}) {
  const monitorId = typeof input?.monitorId === "string" ? input.monitorId.trim() : "";
  const monitor = monitorId ? await getOwnedMonitor(userId, monitorId) : null;
  if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
  const { errors, title, startAt, endAt } = validateWindowInput(input);
  if (Object.keys(errors).length > 0) throw new UptimeError("VALIDATION_FAILED", 400, { errors });
  const row = await prisma.maintenanceWindow.create({
    data: {
      monitorId: monitor.id,
      userId,
      title,
      description: typeof input?.description === "string" ? input.description.slice(0, 2000) : null,
      startAt,
      endAt,
      timezone: input.timezone,
      suppressAlerts: input?.suppressAlerts ?? true,
      pauseChecks: input?.pauseChecks ?? false,
      status: "ACTIVE",
    },
  });
  return publicWindow(row);
}

export async function listWindows(userId, monitorId = null) {
  const where = { userId };
  if (monitorId) {
    const monitor = await getOwnedMonitor(userId, monitorId);
    if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
    where.monitorId = monitor.id;
  }
  const rows = await prisma.maintenanceWindow.findMany({ where, orderBy: { startAt: "asc" }, take: 100 });
  return { windows: rows.map(publicWindow) };
}

export async function getWindow(userId, windowId) {
  const row = await prisma.maintenanceWindow.findFirst({ where: { id: windowId, userId } });
  if (!row) throw new UptimeError("WINDOW_NOT_FOUND", 404);
  return publicWindow(row);
}

export async function cancelWindow(userId, windowId) {
  const row = await prisma.maintenanceWindow.findFirst({ where: { id: windowId, userId } });
  if (!row) throw new UptimeError("WINDOW_NOT_FOUND", 404);
  const updated = await prisma.maintenanceWindow.update({ where: { id: row.id }, data: { status: "CANCELLED" } });
  return publicWindow(updated);
}

export async function deleteWindow(userId, windowId) {
  const row = await prisma.maintenanceWindow.findFirst({ where: { id: windowId, userId } });
  if (!row) throw new UptimeError("WINDOW_NOT_FOUND", 404);
  await prisma.maintenanceWindow.delete({ where: { id: row.id } });
  return { deleted: true };
}

// --- Notifications ---

export async function listNotifications(userId, { page = 1, pageSize = 20, monitorId = null } = {}) {
  const where = {};
  if (monitorId) {
    const monitor = await getOwnedMonitor(userId, monitorId);
    if (!monitor) throw new UptimeError("MONITOR_NOT_FOUND", 404);
    where.monitorId = monitor.id;
  } else {
    const monitors = await prisma.websiteMonitor.findMany({ where: { userId }, select: { id: true } });
    where.monitorId = { in: monitors.map((m) => m.id) };
  }
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.monitorNotification.count({ where }),
    prisma.monitorNotification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return { notifications: rows.map(publicNotification), total, page, pageSize: take };
}

export async function acknowledgeNotification(userId, notificationId, action = "READ") {
  const row = await prisma.monitorNotification.findFirst({ where: { id: notificationId } });
  if (!row) throw new UptimeError("NOTIFICATION_NOT_FOUND", 404);
  const monitor = await getOwnedMonitor(userId, row.monitorId);
  if (!monitor) throw new UptimeError("NOTIFICATION_NOT_FOUND", 404);
  const status = action === "DISMISSED" ? "DISMISSED" : "READ";
  const updated = await prisma.monitorNotification.update({
    where: { id: row.id },
    data: { status, acknowledgedAt: new Date() },
  });
  return publicNotification(updated);
}

export async function getSchedulerHealth() {
  const state = await prisma.monitoringSchedulerState.findUnique({ where: { id: "scheduler" } });
  return {
    schedulerConfigured: Boolean(process.env.MONITORING_TICK_SECRET),
    lastTickAt: state?.lastTickAt ? state.lastTickAt.toISOString() : null,
    lastTickSummary: state?.lastTickSummary ?? {},
    emailConfigured: getEmailStatus().configured,
    emailStatus: getEmailStatus().status,
    note: "Scheduled monitoring is operational only when an external scheduler calls POST /api/monitoring/internal/tick with the server-only secret. A configured secret alone does not prove recurring checks are running; lastTickAt is the evidence.",
  };
}

// --- Durable scheduler tick ---

export async function runTick(deps = {}) {
  const nowMs = deps.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const workerId = deps.workerId ?? `tick-${randomUUID()}`;
  const batchLimit = deps.batchLimit ?? UPTIME_LIMITS.maxChecksPerTick;
  const probeFn = deps.probe ?? null;
  const summary = { claimed: 0, completed: 0, staleRecovered: 0, purged: 0, windowEvents: 0, skippedPausedWindow: 0 };

  // 1. Stale-lease recovery: a crashed worker's RUNNING rows become STALE
  // (infrastructure outcome — never a website failure, never an incident).
  const staleMonitors = await prisma.websiteMonitor.findMany({
    where: { leaseOwner: { not: null }, leaseExpiresAt: { lt: now } },
    select: { id: true },
  });
  for (const stale of staleMonitors) {
    await prisma.monitorCheck.updateMany({
      where: { monitorId: stale.id, outcome: "RUNNING", completedAt: null },
      data: { outcome: "STALE", completedAt: now, errorCode: "STALE_LEASE" },
    });
    await prisma.websiteMonitor.update({
      where: { id: stale.id },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
    summary.staleRecovered += 1;
  }

  // 2. Retention purge in bounded batches (90 days, never open-incident
  // rows — incidents keep their own timestamps independently).
  const cutoff = new Date(nowMs - UPTIME_LIMITS.retentionDays * 24 * 60 * 60 * 1000);
  for (let batch = 0; batch < 5; batch++) {
    const old = await prisma.monitorCheck.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: UPTIME_LIMITS.purgeBatch,
    });
    if (old.length === 0) break;
    await prisma.monitorCheck.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    summary.purged += old.length;
    if (old.length < UPTIME_LIMITS.purgeBatch) break;
  }

  // 3. Window lifecycle (global, bounded): starting notices + endings.
  const starting = await prisma.maintenanceWindow.findMany({
    where: {
      status: "ACTIVE",
      startAt: { gt: now, lte: new Date(nowMs + UPTIME_LIMITS.windowStartingNoticeMs) },
    },
    take: 50,
  });
  for (const window of starting) {
    const monitor = await prisma.websiteMonitor.findUnique({ where: { id: window.monitorId } });
    if (!monitor || !monitor.notifyInApp) continue;
    const created = await createNotificationIfAbsent({
      monitor, windowId: window.id, type: "WINDOW_STARTING",
      title: "Maintenance window starting soon",
      body: `A scheduled maintenance window starts within the next hour. Alert suppression follows the window's configured policy.`,
    });
    if (created) summary.windowEvents += 1;
  }
  const ending = await prisma.maintenanceWindow.findMany({
    where: { status: "ACTIVE", endAt: { lte: now } },
    take: 50,
  });
  for (const window of ending) {
    await prisma.maintenanceWindow.update({ where: { id: window.id }, data: { status: "COMPLETED" } });
    const monitor = await prisma.websiteMonitor.findUnique({ where: { id: window.monitorId } });
    if (monitor && monitor.notifyInApp) {
      const created = await createNotificationIfAbsent({
        monitor, windowId: window.id, type: "WINDOW_ENDED",
        title: "Maintenance window ended",
        body: "A scheduled maintenance window has ended. Normal incident evaluation has resumed.",
      });
      if (created) summary.windowEvents += 1;
    }
  }

  // 4. Claim due monitors with an atomic conditional update — two
  // concurrent ticks cannot claim the same monitor.
  const candidates = await prisma.websiteMonitor.findMany({
    where: { status: "ENABLED", nextCheckAt: { lte: now } },
    orderBy: { nextCheckAt: "asc" },
    take: batchLimit * 3,
  });
  const claimed = [];
  for (const candidate of candidates) {
    if (claimed.length >= batchLimit) break;
    const result = await prisma.websiteMonitor.updateMany({
      where: {
        id: candidate.id,
        // The schedule must STILL be due at claim time: a concurrent tick
        // holding a stale candidate list cannot re-claim a monitor whose
        // check just completed and advanced nextCheckAt past now.
        nextCheckAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: { leaseOwner: workerId, leaseExpiresAt: new Date(nowMs + UPTIME_LIMITS.leaseMs) },
    });
    if (result.count === 1) claimed.push(candidate);
  }
  summary.claimed = claimed.length;

  // 5. Run claimed checks sequentially (bounded concurrency = 1 per
  // tick; the scanner itself caps global concurrency at 5).
  for (const candidate of claimed) {
    try {
      const fresh = await prisma.websiteMonitor.findUnique({ where: { id: candidate.id } });
      if (!fresh || fresh.status !== "ENABLED") continue;
      const windows = await prisma.maintenanceWindow.findMany({
        where: { monitorId: fresh.id, status: "ACTIVE" },
        orderBy: { startAt: "asc" },
      });
      const activeWindow = findActiveWindow(windows, nowMs);
      if (activeWindow && activeWindow.pauseChecks) {
        // User explicitly configured pause-during-window: skip probing,
        // advance the schedule, mark state MAINTENANCE. No check row is
        // fabricated; the gap is visible as missing observations.
        await prisma.websiteMonitor.update({
          where: { id: fresh.id },
          data: {
            currentState: "MAINTENANCE",
            nextCheckAt: new Date(nowMs + fresh.checkIntervalMinutes * 60 * 1000),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        summary.skippedPausedWindow += 1;
        continue;
      }
      await runCheckForMonitor(fresh, {
        triggeredBy: "SCHEDULED",
        probe: probeFn,
        nowMs,
        workerId,
        scheduledAt: candidate.nextCheckAt,
      });
      summary.completed += 1;
    } catch {
      // A failed run must not leave a dangling lease or a fake check.
      await prisma.websiteMonitor.update({
        where: { id: candidate.id },
        data: { leaseOwner: null, leaseExpiresAt: null },
      }).catch(() => {});
      await prisma.monitorCheck.updateMany({
        where: { monitorId: candidate.id, outcome: "RUNNING", completedAt: null },
        data: { outcome: "UNKNOWN", completedAt: now, errorCode: "INTERNAL_SCANNER_ERROR" },
      }).catch(() => {});
    }
  }

  await prisma.monitoringSchedulerState.upsert({
    where: { id: "scheduler" },
    create: { id: "scheduler", lastTickAt: now, lastTickSummary: summary },
    update: { lastTickAt: now, lastTickSummary: summary },
  });
  return { workerId, ...summary };
}
