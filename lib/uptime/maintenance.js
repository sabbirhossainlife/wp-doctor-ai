// Tool 12 maintenance detection and scheduled-window rules (Milestone 16).
// Two separate concepts, never conflated:
//   (a) OBSERVED maintenance: HTTP evidence only — 503 plus the standard
//       WordPress maintenance-page phrase in a bounded response prefix.
//       A generic 503 is NOT maintenance. The phrase match is an observed
//       indicator, never proof of complete WordPress internal state.
//   (b) SCHEDULED windows: user-authorised, one-time only. Recurrence is
//       NOT implemented (never guessed). Timestamps are stored UTC; the
//       IANA timezone is preserved for display and interpretation.
// Connector-reported maintenance does NOT exist: no maintenance field
// exists in connector snapshot schema v7 (verified by grep), so no such
// evidence is consulted or invented here.

export const WP_MAINTENANCE_PHRASE = "briefly unavailable for scheduled maintenance";
export const WINDOW_MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export function detectMaintenance({ httpStatus = null, headPrefix = null, enabled = true } = {}) {
  if (!enabled) return { observed: false, indicator: "NOT_CHECKED" };
  if (httpStatus !== 503) return { observed: false, indicator: "NOT_OBSERVED" };
  if (typeof headPrefix !== "string") return { observed: false, indicator: "INSUFFICIENT_EVIDENCE" };
  if (headPrefix.toLowerCase().includes(WP_MAINTENANCE_PHRASE)) {
    return { observed: true, indicator: "OBSERVED" };
  }
  return { observed: false, indicator: "NOT_OBSERVED" };
}

export function isValidTimezone(timezone) {
  if (typeof timezone !== "string" || timezone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function validateWindowInput(input = {}) {
  const errors = {};
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 200) errors.title = "A title of 1–200 characters is required.";
  if (input?.recurrence !== undefined && input.recurrence !== null && input.recurrence !== "NONE") {
    errors.recurrence = "Recurring maintenance windows are not supported; create one-time windows only.";
  }
  if (!isValidTimezone(input?.timezone)) errors.timezone = "A valid IANA timezone identifier is required.";
  const startAt = input?.startAt ? new Date(input.startAt) : null;
  const endAt = input?.endAt ? new Date(input.endAt) : null;
  if (!startAt || Number.isNaN(startAt.getTime())) errors.startAt = "A valid start datetime is required.";
  if (!endAt || Number.isNaN(endAt.getTime())) errors.endAt = "A valid end datetime is required.";
  if (startAt && endAt && !Number.isNaN(startAt.getTime()) && !Number.isNaN(endAt.getTime())) {
    if (endAt <= startAt) errors.endAt = "End must be after start.";
    else if (endAt - startAt > WINDOW_MAX_DURATION_MS) errors.endAt = "A maintenance window may last at most 14 days.";
  }
  return { errors, title, startAt, endAt };
}

export function isWindowActive(window, nowMs = Date.now()) {
  if (!window || window.status !== "ACTIVE") return false;
  const start = new Date(window.startAt).getTime();
  const end = new Date(window.endAt).getTime();
  return start <= nowMs && nowMs < end;
}

export function findActiveWindow(windows = [], nowMs = Date.now()) {
  return windows.find((w) => isWindowActive(w, nowMs)) ?? null;
}
