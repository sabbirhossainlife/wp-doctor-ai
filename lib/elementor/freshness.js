// Elementor snapshot freshness (Milestone 8). Same 24 h policy, statuses,
// re-sync instructions, and no-row-on-blocked-run rule as Tools 02/03.
// Accepts schema 1|2|3|4; a v1-v3 snapshot is CURRENT here but carries no
// Elementor data, which the engine reports as INSUFFICIENT_EVIDENCE.
import { snapshotFreshness, RESYNC_INSTRUCTIONS } from "../conflict/freshness.js";

export { RESYNC_INSTRUCTIONS };

export function elementorSnapshotMaxAgeMs(env = process.env) {
  const raw = Number.parseInt(env.ELEMENTOR_SNAPSHOT_MAX_AGE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
}

export function elementorSnapshotFreshness(snapshotRow, options = {}) {
  return snapshotFreshness(snapshotRow, {
    nowMs: options.nowMs ?? Date.now(),
    maxAgeMs: options.maxAgeMs ?? elementorSnapshotMaxAgeMs(options.env),
  });
}
