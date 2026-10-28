import test from "node:test";
import assert from "node:assert/strict";
import { buildReadiness } from "../lib/readiness.js";

const baseEnv = { NODE_ENV: "test" };

test("readiness: unconfigured env is DEGRADED overall, never READY, and leaks no paths or keys", () => {
  const r = buildReadiness({ env: { ...baseEnv }, dbOk: true });
  assert.equal(r.overall, "DEGRADED");
  assert.equal(r.components.backupStorage.state, "NOT_CONFIGURED");
  assert.equal(r.components.backupEncryption.state, "NOT_CONFIGURED");
  assert.equal(r.components.scheduledMonitoring.state, "NOT_CONFIGURED");
  assert.equal(r.components.ai.state, "NOT_CONFIGURED");
  assert.equal(r.components.emailNotifications.state, "NOT_CONFIGURED");
  assert.equal(r.components.sharedRateLimit.state, "NOT_CONFIGURED");
  const text = JSON.stringify(r);
  assert.ok(!text.includes("/var/") && !text.includes("BACKUP_ENCRYPTION_KEY="));
});

test("readiness: failed DB check forces BLOCKED overall", () => {
  const r = buildReadiness({ env: { ...baseEnv }, dbOk: false });
  assert.equal(r.overall, "BLOCKED");
  assert.equal(r.components.database.state, "BLOCKED");
});

test("readiness: scheduler secret without any tick is DEGRADED, not operational", () => {
  const r = buildReadiness({ env: { ...baseEnv }, dbOk: true, schedulerSecretConfigured: true, schedulerLastTickAt: null });
  assert.equal(r.components.scheduledMonitoring.state, "DEGRADED");
  assert.notEqual(r.components.scheduledMonitoring.state, "READY");
});

test("readiness: recent tick is READY, stale tick is DEGRADED", () => {
  const now = Date.now();
  const fresh = buildReadiness({ env: { ...baseEnv }, dbOk: true, schedulerSecretConfigured: true, schedulerLastTickAt: new Date(now - 60_000).toISOString(), nowMs: now });
  assert.equal(fresh.components.scheduledMonitoring.state, "READY");
  const stale = buildReadiness({ env: { ...baseEnv }, dbOk: true, schedulerSecretConfigured: true, schedulerLastTickAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(), nowMs: now });
  assert.equal(stale.components.scheduledMonitoring.state, "DEGRADED");
});

test("readiness: AI variables present but unverified report NOT_TESTED, never READY", () => {
  const r = buildReadiness({ env: { ...baseEnv, AI_PROVIDER: "openai", OPENAI_API_KEY: "placeholder" }, dbOk: true });
  assert.equal(r.components.ai.state, "NOT_TESTED");
});

test("readiness: production with local storage driver is BLOCKED for durability", () => {
  const r = buildReadiness({ env: { NODE_ENV: "production", BACKUP_STORAGE_DRIVER: "local", BACKUP_STORAGE_DIR: "/tmp/x" }, dbOk: true });
  assert.equal(r.components.productionBackupDurability.state, "BLOCKED");
  assert.equal(r.components.backupStorage.state, "BLOCKED");
});
