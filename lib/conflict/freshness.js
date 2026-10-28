// Snapshot freshness policy (Milestone 6). A diagnostic is NEVER run on
// stale data presented as current. The caller maps these statuses to a
// 422 response with re-sync instructions; no diagnostic row is persisted
// for a blocked run.
import { validateSnapshot } from "../connector/validate-snapshot.js";

export const RESYNC_INSTRUCTIONS =
  "Open the WP Doctor AI Connector admin page in WordPress (WP Doctor AI menu, manage_options capability) and explicitly request a new diagnostic sync (\"Send diagnostic snapshot\"), then re-run this check. No remote sync is triggered from this app.";

export function conflictSnapshotMaxAgeMs(env = process.env) {
  const raw = Number.parseInt(env.CONFLICT_SNAPSHOT_MAX_AGE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
}

// snapshotRow: ConnectorDiagnosticSnapshot row or null. nowMs injectable.
// Returns { status, maxAgeMs, receivedAt } where status is one of
// CURRENT | SNAPSHOT_MISSING | SNAPSHOT_INVALID | SNAPSHOT_UNSUPPORTED | SNAPSHOT_STALE.
export function snapshotFreshness(snapshotRow, { nowMs = Date.now(), maxAgeMs = conflictSnapshotMaxAgeMs() } = {}) {
  if (!snapshotRow) return { status: "SNAPSHOT_MISSING", maxAgeMs, receivedAt: null };
  const payload = snapshotRow.payload;
  if (!payload || typeof payload !== "object") return { status: "SNAPSHOT_INVALID", maxAgeMs, receivedAt: null };
  // Milestone 7: v3 is a superset of v2 (same plugins/theme fields), so
  // Tool 02 keeps working on v3 snapshots. Tool 03 freshness wraps this
  // helper with its own max-age constant. Milestone 8: v4 is a superset of
  // v3, so Tools 02/03 keep working on v4 snapshots unchanged.
  if (payload.schemaVersion !== 1 && payload.schemaVersion !== 2 && payload.schemaVersion !== 3 && payload.schemaVersion !== 4) {
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
