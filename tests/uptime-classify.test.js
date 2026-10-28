// Tool 12 classification matrix (Milestone 16). Pure function tests.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyCheck } from "../lib/uptime/classify.js";

test("uptime classify: 2xx success, warning flag, high-latency degraded", () => {
  assert.equal(classifyCheck({ httpStatus: 200, latencyMs: 500 }).outcome, "UP");
  assert.equal(classifyCheck({ httpStatus: 200, latencyMs: 500 }).latencyWarning, false);
  assert.equal(classifyCheck({ httpStatus: 200, latencyMs: 1500 }).latencyWarning, true);
  assert.equal(classifyCheck({ httpStatus: 200, latencyMs: 1500 }).outcome, "UP");
  const degraded = classifyCheck({ httpStatus: 200, latencyMs: 3000 });
  assert.equal(degraded.outcome, "DEGRADED");
  assert.equal(degraded.degradedReason, "HIGH_LATENCY");
});

test("uptime classify: redirect ending in success is UP; terminal redirect degraded", () => {
  assert.equal(classifyCheck({ httpStatus: 200, latencyMs: 100 }).outcome, "UP");
  assert.equal(classifyCheck({ httpStatus: 302 }).degradedReason, "TERMINAL_REDIRECT");
});

test("uptime classify: 4xx are degraded, never downtime", () => {
  for (const status of [400, 401, 403, 404, 429]) {
    const result = classifyCheck({ httpStatus: status });
    assert.equal(result.outcome, "DEGRADED", `HTTP ${status}`);
    assert.equal(result.failureReason, null);
  }
  assert.equal(classifyCheck({ httpStatus: 401 }).degradedReason, "ACCESS_RESTRICTED");
  assert.equal(classifyCheck({ httpStatus: 403 }).degradedReason, "ACCESS_RESTRICTED");
  assert.equal(classifyCheck({ httpStatus: 429 }).degradedReason, "RATE_LIMITED");
});

test("uptime classify: 5xx failure; redirect loop degraded; transport failures separated", () => {
  assert.deepEqual(
    (({ outcome, failureReason }) => ({ outcome, failureReason }))(classifyCheck({ httpStatus: 500 })),
    { outcome: "FAILURE", failureReason: "HTTP_5XX" },
  );
  assert.equal(classifyCheck({ errorCode: "TOO_MANY_REDIRECTS" }).outcome, "DEGRADED");
  assert.equal(classifyCheck({ errorCode: "DNS_FAILURE" }).failureReason, "DNS");
  assert.equal(classifyCheck({ errorCode: "TLS_FAILURE" }).failureReason, "TLS");
  assert.equal(classifyCheck({ errorCode: "CONNECTION_FAILURE" }).failureReason, "CONNECTION");
  assert.equal(classifyCheck({ errorCode: "REQUEST_TIMEOUT" }).failureReason, "TIMEOUT");
});

test("uptime classify: blocked and unknown are never failures", () => {
  assert.equal(classifyCheck({ errorCode: "PROHIBITED_DESTINATION" }).outcome, "BLOCKED");
  assert.equal(classifyCheck({ errorCode: "TARGET_MISMATCH" }).outcome, "BLOCKED");
  assert.equal(classifyCheck({ errorCode: "INVALID_URL" }).outcome, "BLOCKED");
  assert.equal(classifyCheck({ errorCode: "UNSUPPORTED_SCHEME" }).outcome, "BLOCKED");
  assert.equal(classifyCheck({ errorCode: "UNSUPPORTED_PORT" }).outcome, "BLOCKED");
  assert.equal(classifyCheck({ errorCode: "INTERNAL_SCANNER_ERROR" }).outcome, "UNKNOWN");
  assert.equal(classifyCheck({}).outcome, "UNKNOWN");
});

test("uptime classify: maintenance observed wins over 5xx", () => {
  assert.equal(classifyCheck({ httpStatus: 503, maintenanceObserved: true }).outcome, "MAINTENANCE_OBSERVED");
  assert.equal(classifyCheck({ httpStatus: 503, maintenanceObserved: false }).outcome, "FAILURE");
});

test("uptime classify: failed transport is never a successful high-latency response", () => {
  const result = classifyCheck({ errorCode: "REQUEST_TIMEOUT", latencyMs: 99999 });
  assert.equal(result.outcome, "FAILURE");
  assert.equal(result.latencyWarning, false);
});
