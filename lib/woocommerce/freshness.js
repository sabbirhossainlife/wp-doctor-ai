// WooCommerce snapshot freshness (Milestone 7). Reuses Tool 02's 24 h
// policy exactly: the same statuses, the same re-sync instructions, and
// the same rule that a blocked run persists NO diagnostic row. The only
// difference is the constant name / env var, so the two tools can be tuned
// independently. The underlying helper accepts schema 1|2|3 (v3 is a
// superset of v2); a v1/v2 snapshot is CURRENT here but carries no
// WooCommerce data, which the engine reports as INSUFFICIENT_EVIDENCE.
import { snapshotFreshness, RESYNC_INSTRUCTIONS } from "../conflict/freshness.js";

export { RESYNC_INSTRUCTIONS };

export function wooSnapshotMaxAgeMs(env = process.env) {
  const raw = Number.parseInt(env.WOO_SNAPSHOT_MAX_AGE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
}

export function wooSnapshotFreshness(snapshotRow, options = {}) {
  return snapshotFreshness(snapshotRow, {
    nowMs: options.nowMs ?? Date.now(),
    maxAgeMs: options.maxAgeMs ?? wooSnapshotMaxAgeMs(options.env),
  });
}
