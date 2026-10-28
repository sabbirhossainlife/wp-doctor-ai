// Final-integration readiness report (Phase G).
//
// Pure, dependency-injected: the route supplies live facts, tests supply
// stubs. This module NEVER returns secret values, connection strings,
// storage directory paths, or key material — only states, reason codes,
// and presence booleans. States: READY / DEGRADED / BLOCKED /
// NOT_CONFIGURED / NOT_TESTED. The overall state is deliberately never
// "production ready": it summarises component readiness only, and a
// responding homepage alone never makes the product production-ready.
import { storageReadiness, encryptionReadiness } from "./backup/storage.js";

export const READINESS_STATES = ["READY", "DEGRADED", "BLOCKED", "NOT_CONFIGURED", "NOT_TESTED"];

const SCHEDULER_FRESH_MS = 2 * 60 * 60 * 1000; // matches the uptime page's "running" window

export function buildReadiness({
  env = process.env,
  dbOk = false,
  schedulerSecretConfigured = false,
  schedulerLastTickAt = null,
  nowMs = Date.now(),
} = {}) {
  const storage = storageReadiness(env);
  const encryption = encryptionReadiness(env);
  const isProduction = env.NODE_ENV === "production";

  const backupStorage = storage.ready
    ? { state: "READY", detail: "Private local adapter configured (development/test only)." }
    : {
        state: storage.reason === "PRODUCTION_LOCAL_STORAGE" || storage.reason === "UNSUPPORTED_STORAGE_DRIVER"
          ? "BLOCKED"
          : "NOT_CONFIGURED",
        detail: `Backup execution blocked: ${storage.reason}.`,
      };
  const backupEncryption = encryption.ready
    ? { state: "READY", detail: "AES-256-GCM key configured (key material never reported)." }
    : { state: "NOT_CONFIGURED", detail: "BACKUP_ENCRYPTION_KEY missing or malformed; no plaintext fallback exists." };

  let scheduledMonitoring;
  if (!schedulerSecretConfigured) {
    scheduledMonitoring = {
      state: "NOT_CONFIGURED",
      detail: "MONITORING_TICK_SECRET unset: the tick endpoint returns 503 and no recurring checks run.",
    };
  } else if (!schedulerLastTickAt) {
    scheduledMonitoring = {
      state: "DEGRADED",
      detail: "Tick secret configured but no tick has ever been persisted: no scheduler has demonstrably run.",
    };
  } else if (nowMs - new Date(schedulerLastTickAt).getTime() <= SCHEDULER_FRESH_MS) {
    scheduledMonitoring = {
      state: "READY",
      detail: "A scheduler tick was persisted recently (lastTickAt is the evidence, not the secret).",
    };
  } else {
    scheduledMonitoring = {
      state: "DEGRADED",
      detail: "Last persisted tick is stale: the external scheduler may have stopped.",
    };
  }

  const aiConfigured = Boolean((env.AI_PROVIDER ?? "").trim() && (env.OPENAI_API_KEY ?? "").trim());
  const ai = aiConfigured
    ? { state: "NOT_TESTED", detail: "Provider variables present, but no provider call has been verified in this environment." }
    : { state: "NOT_CONFIGURED", detail: "AI_NOT_CONFIGURED: deterministic diagnostics still work; AI explanations return 503." };

  const components = {
    application: { state: "READY", detail: "Application code loaded and responding." },
    database: dbOk
      ? { state: "READY", detail: "PostgreSQL reachable and query succeeded." }
      : { state: "BLOCKED", detail: "Database connectivity check failed." },
    backupStorage,
    backupEncryption,
    scheduledMonitoring,
    ai,
    emailNotifications: {
      state: "NOT_CONFIGURED",
      detail: "EMAIL_NOT_CONFIGURED: no email-delivery adapter exists; in-app notifications only.",
    },
    searchConsole: {
      state: "NOT_CONFIGURED",
      detail: "No Search Console integration exists; Tool 11 reports signals only, never indexing status.",
    },
    connector: {
      state: "NOT_TESTED",
      detail: "Connector 1.7.0 / snapshot schema v7 code present; live pairing not verified in this report.",
    },
    sharedRateLimit: {
      state: "NOT_CONFIGURED",
      detail: "Rate limits are in-memory and single-process only; they do not protect a multi-instance deployment.",
    },
    productionBackupDurability: isProduction
      ? { state: "BLOCKED", detail: "Local storage is blocked in production; a private persistent object store is required." }
      : { state: "NOT_CONFIGURED", detail: "No persistent object-storage adapter exists; local storage is development/test only." },
  };

  const overall = !dbOk
    ? "BLOCKED"
    : Object.values(components).some((c) => c.state === "BLOCKED")
      ? "BLOCKED"
      : Object.values(components).some((c) => c.state === "NOT_CONFIGURED" || c.state === "DEGRADED")
        ? "DEGRADED"
        : "READY";

  return {
    overall,
    generatedAt: new Date(nowMs).toISOString(),
    note: "Component states only. This report never implies production readiness on its own; see docs/deployment-checklist.md.",
    components,
  };
}
