// Tool 12 availability statistics (Milestone 16). Pure functions over
// stored checks only — never invented measurements, never filled gaps.
//
// Availability % = UP checks / (UP + DEGRADED + FAILURE checks) in the
// period. MAINTENANCE, BLOCKED, UNKNOWN, and STALE checks are EXCLUDED
// from the denominator and reported separately: planned-maintenance time
// is not counted as uptime, paused/missing periods are not counted as
// successful, and periods with no eligible checks yield null (an
// evidence limitation), never 0% or 100%. Response-time statistics use
// UP checks only and require at least 2 valid observations.
const ELIGIBLE = new Set(["UP", "DEGRADED", "FAILURE"]);

export function computeAvailability(checks = []) {
  let up = 0;
  let degraded = 0;
  let failure = 0;
  let maintenance = 0;
  let blocked = 0;
  let unknown = 0;
  for (const check of checks) {
    if (check.outcome === "UP") up += 1;
    else if (check.outcome === "DEGRADED") degraded += 1;
    else if (check.outcome === "FAILURE") failure += 1;
    else if (check.outcome === "MAINTENANCE_OBSERVED") maintenance += 1;
    else if (check.outcome === "BLOCKED") blocked += 1;
    else unknown += 1;
  }
  const denominator = up + degraded + failure;
  return {
    upCount: up,
    degradedCount: degraded,
    failureCount: failure,
    maintenanceCount: maintenance,
    blockedCount: blocked,
    unknownCount: unknown,
    eligibleCount: denominator,
    totalChecks: checks.length,
    availabilityPercent: denominator > 0 ? Math.round((up / denominator) * 1000) / 10 : null,
    denominatorNote: "UP / (UP + DEGRADED + FAILURE). Maintenance, blocked, unknown, and missing/paused periods are excluded, not counted as uptime.",
  };
}

export function responseTimeStats(checks = []) {
  const latencies = checks
    .filter((c) => c.outcome === "UP" && typeof c.latencyMs === "number")
    .map((c) => c.latencyMs)
    .sort((a, b) => a - b);
  if (latencies.length < 2) {
    return { count: latencies.length, averageMs: null, p50Ms: null, p95Ms: null, note: "At least 2 successful observations are required." };
  }
  const sum = latencies.reduce((a, b) => a + b, 0);
  const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.ceil((p / 100) * latencies.length) - 1)];
  return {
    count: latencies.length,
    averageMs: Math.round(sum / latencies.length),
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    note: null,
  };
}
