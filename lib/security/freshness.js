// Snapshot freshness policy (Tool 08). Same 24 h policy and statuses as
// Tools 02-04/06/07, but accepting schema v1-v6. A diagnostic is NEVER run
// on stale data presented as current. The caller maps non-CURRENT statuses
// to a 422 response with re-sync instructions; no diagnostic row is
// persisted for a blocked run. Schema < 6 is NOT blocked: it simply lacks
// securityIndicators, which the rules engine reports as insufficient
// evidence for hardening checks only.
import { validateSnapshot } from "../connector/validate-snapshot.js";

export const RESYNC_INSTRUCTIONS =
  "Open the WP Doctor AI Connector admin page in WordPress (WP Doctor AI menu, manage_options capability) and explicitly request a new diagnostic sync (\"Send diagnostic snapshot\"), then re-run this check. No remote sync is triggered from this app.";

export function securitySnapshotMaxAgeMs(env = process.env) {
  const raw = Number.parseInt(env.SECURITY_SNAPSHOT_MAX_AGE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
}

export function securitySnapshotFreshness(snapshotRow, { nowMs = Date.now(), maxAgeMs = securitySnapshotMaxAgeMs() } = {}) {
  if (!snapshotRow) return { status: "SNAPSHOT_MISSING", maxAgeMs, receivedAt: null };
  const payload = snapshotRow.payload;
  if (!payload || typeof payload !== "object") return { status: "SNAPSHOT_INVALID", maxAgeMs, receivedAt: null };
  if (![1, 2, 3, 4, 5, 6].includes(payload.schemaVersion)) {
    return { status: "SNAPSHOT_UNSUPPORTED", maxAgeMs, receivedAt: snapshotRow.receivedAt ?? null };
  }
  const validated = validateSnapshot(payload);
  if (!validated.ok) return { status: "SNAPSHOT_INVALID", maxAgeMs, receivedAt: snapshotRow.receivedAt ?? null };
  const receivedAt = snapshotRow.receivedAt instanceof Date ? snapshotRow.receivedAt : new Date(snapshotRow.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) return { status: "SNAPSHOT_INVALID", maxAgeMs, receivedAt: null };
  if (nowMs - receivedAt.getTime() > maxAgeMs) {
    return { status: "SNAPSHOT_STALE", maxAgeMs, receivedAt };
  }
  return { status: "CURRENT", maxAgeMs, receivedAt };
}
