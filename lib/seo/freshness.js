// Snapshot freshness policy (Tool 11). Same 24 h policy and statuses as
// Tools 02-04/06/07/08/09, accepting schema v1-v7. Applies ONLY to the
// websiteId path: a stale snapshot blocks the run (422, no row
// persisted). The URL-only path has no snapshot and is unaffected.
import { validateSnapshot } from "../connector/validate-snapshot.js";

export const RESYNC_INSTRUCTIONS =
  "Open the WP Doctor AI Connector admin page in WordPress (WP Doctor AI menu, manage_options capability) and explicitly request a new diagnostic sync (\"Send diagnostic snapshot\"), then re-run this check. No remote sync is triggered from this app.";

export function seoSnapshotMaxAgeMs(env = process.env) {
  const raw = Number.parseInt(env.SEO_SNAPSHOT_MAX_AGE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
}

export function seoSnapshotFreshness(snapshotRow, { nowMs = Date.now(), maxAgeMs = seoSnapshotMaxAgeMs() } = {}) {
  if (!snapshotRow) return { status: "SNAPSHOT_MISSING", maxAgeMs, receivedAt: null };
  const payload = snapshotRow.payload;
  if (!payload || typeof payload !== "object") return { status: "SNAPSHOT_INVALID", maxAgeMs, receivedAt: null };
  if (![1, 2, 3, 4, 5, 6, 7].includes(payload.schemaVersion)) {
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
