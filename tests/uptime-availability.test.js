// Tool 12 availability + response-time statistics (Milestone 16).
import test from "node:test";
import assert from "node:assert/strict";
import { computeAvailability, responseTimeStats } from "../lib/uptime/availability.js";

function check(outcome, latencyMs = null) {
  return { outcome, latencyMs };
}

test("uptime availability: denominator excludes maintenance, blocked, unknown", () => {
  const stats = computeAvailability([
    check("UP"), check("UP"), check("DEGRADED"), check("FAILURE"),
    check("MAINTENANCE_OBSERVED"), check("BLOCKED"), check("UNKNOWN"),
  ]);
  assert.equal(stats.eligibleCount, 4);
  assert.equal(stats.availabilityPercent, 50);
  assert.equal(stats.maintenanceCount, 1);
  assert.equal(stats.blockedCount, 1);
  assert.equal(stats.unknownCount, 1);
});

test("uptime availability: paused/missing periods are never counted as success", () => {
  const stats = computeAvailability([]);
  assert.equal(stats.availabilityPercent, null);
  assert.equal(stats.eligibleCount, 0);
  const onlyMaintenance = computeAvailability([check("MAINTENANCE_OBSERVED")]);
  assert.equal(onlyMaintenance.availabilityPercent, null);
});

test("uptime availability: response-time stats need 2 successful observations", () => {
  assert.equal(responseTimeStats([]).averageMs, null);
  assert.equal(responseTimeStats([check("UP", 100)]).averageMs, null);
  assert.equal(responseTimeStats([check("UP", 100), check("FAILURE", 9999), check("UP", 300)]).count, 2);
  const stats = responseTimeStats([check("UP", 100), check("UP", 300)]);
  assert.equal(stats.averageMs, 200);
  assert.equal(stats.p50Ms, 100);
  assert.equal(stats.p95Ms, 300);
});
