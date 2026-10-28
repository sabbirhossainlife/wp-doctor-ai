// Tool 12 check classification (Milestone 16). Pure and deterministic —
// no I/O, no database, no network. A check outcome is NEVER a claim
// about worldwide availability: it is the result observed from this
// single monitoring location at one point in time.
//
// Outcome vocabulary:
//   UP — 2xx and latency below the high-latency threshold.
//   DEGRADED — the server responded, but an actionable condition was
//     observed (high latency, access restriction, not-found, rate limit,
//     terminal redirect, redirect loop/limit). Responding is NOT downtime.
//   FAILURE — a qualifying failure (transport failure or 5xx) that counts
//     toward the incident threshold, with a separate failureReason.
//   MAINTENANCE_OBSERVED — 503 plus a recognised WordPress maintenance
//     signature (decided in maintenance.js, passed in here).
//   BLOCKED — the check was not executed or not completed because a
//     security/configuration condition required it (prohibited
//     destination, target mismatch). Never counted as a site failure.
//   UNKNOWN — infrastructure/internal failure; never reported as a site
//     outage and never counted toward incidents.
export function classifyCheck(input = {}) {
  const {
    httpStatus = null,
    errorCode = null,
    latencyMs = null,
    maintenanceObserved = false,
    warningLatencyMs = 1000,
    highLatencyMs = 3000,
  } = input;

  if (maintenanceObserved) {
    return {
      outcome: "MAINTENANCE_OBSERVED",
      failureReason: null,
      degradedReason: null,
      latencyWarning: false,
    };
  }

  if (errorCode) {
    switch (errorCode) {
      case "PROHIBITED_DESTINATION":
      case "TARGET_MISMATCH":
      case "INVALID_URL":
      case "UNSUPPORTED_SCHEME":
      case "UNSUPPORTED_PORT":
        // Security-validation blocks: the check was refused before any
        // request, so it is BLOCKED — never a site failure, never unknown.
        return { outcome: "BLOCKED", failureReason: null, degradedReason: null, latencyWarning: false };
      case "DNS_FAILURE":
        return { outcome: "FAILURE", failureReason: "DNS", degradedReason: null, latencyWarning: false };
      case "TLS_FAILURE":
        return { outcome: "FAILURE", failureReason: "TLS", degradedReason: null, latencyWarning: false };
      case "CONNECTION_FAILURE":
        return { outcome: "FAILURE", failureReason: "CONNECTION", degradedReason: null, latencyWarning: false };
      case "REQUEST_TIMEOUT":
        return { outcome: "FAILURE", failureReason: "TIMEOUT", degradedReason: null, latencyWarning: false };
      case "TOO_MANY_REDIRECTS":
        return { outcome: "DEGRADED", failureReason: null, degradedReason: "REDIRECT_LOOP_OR_LIMIT", latencyWarning: false };
      case "RESPONSE_LIMIT_EXCEEDED":
        return { outcome: "DEGRADED", failureReason: null, degradedReason: "RESPONSE_LIMIT", latencyWarning: false };
      case "CROSS_HOST_REDIRECT":
        return { outcome: "DEGRADED", failureReason: null, degradedReason: "CROSS_HOST_REDIRECT_BLOCKED", latencyWarning: false };
      default:
        return { outcome: "UNKNOWN", failureReason: null, degradedReason: null, latencyWarning: false };
    }
  }

  if (httpStatus === null || httpStatus === undefined) {
    return { outcome: "UNKNOWN", failureReason: null, degradedReason: null, latencyWarning: false };
  }

  const latencyWarning =
    typeof latencyMs === "number" && latencyMs >= warningLatencyMs && latencyMs < highLatencyMs;
  const highLatency = typeof latencyMs === "number" && latencyMs >= highLatencyMs;

  if (httpStatus >= 200 && httpStatus < 300) {
    if (highLatency) {
      return { outcome: "DEGRADED", failureReason: null, degradedReason: "HIGH_LATENCY", latencyWarning: false };
    }
    return { outcome: "UP", failureReason: null, degradedReason: null, latencyWarning };
  }
  if (httpStatus >= 300 && httpStatus < 400) {
    return { outcome: "DEGRADED", failureReason: null, degradedReason: "TERMINAL_REDIRECT", latencyWarning: false };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { outcome: "DEGRADED", failureReason: null, degradedReason: "ACCESS_RESTRICTED", latencyWarning: false };
  }
  if (httpStatus === 429) {
    return { outcome: "DEGRADED", failureReason: null, degradedReason: "RATE_LIMITED", latencyWarning: false };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { outcome: "DEGRADED", failureReason: null, degradedReason: "CLIENT_ERROR", latencyWarning: false };
  }
  if (httpStatus >= 500) {
    return { outcome: "FAILURE", failureReason: "HTTP_5XX", degradedReason: null, latencyWarning: false };
  }
  return { outcome: "UNKNOWN", failureReason: null, degradedReason: null, latencyWarning: false };
}
