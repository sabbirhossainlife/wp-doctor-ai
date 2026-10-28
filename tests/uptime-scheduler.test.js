// Tool 12 scheduler trigger authentication (Milestone 16).
import test from "node:test";
import assert from "node:assert/strict";
import { tickSecretConfigured, validateTickSecret } from "../lib/uptime/scheduler.js";

test("uptime scheduler: secret validation is constant-time and strict", () => {
  const env = { MONITORING_TICK_SECRET: "s3cret-value" };
  assert.equal(tickSecretConfigured(env), true);
  assert.equal(validateTickSecret("s3cret-value", env), true);
  assert.equal(validateTickSecret("wrong", env), false);
  assert.equal(validateTickSecret("", env), false);
  assert.equal(validateTickSecret(null, env), false);
  assert.equal(validateTickSecret("s3cret-value", {}), false);
  assert.equal(tickSecretConfigured({}), false);
});
