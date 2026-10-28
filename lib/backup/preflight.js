// Tool 10 read-only preflight (pure). Modifies NOTHING. Any blocker
// means the operation must not proceed to a destructive step.
import { BACKUP_LIMITS } from "./limits.js";
export function canonicalHostFromUrl(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}
export function evaluatePreflight({
  snapshot, snapshotReceivedAt, connectionStatus, storage, encryption,
  mode, multisite, conflictingJobs = [], operationType = "BACKUP",
  sourceSnapshot = null, destinationSnapshot = null, nowMs = Date.now(),
} = {}) {
  const blockers = [];
  const warnings = [];
  if (!snapshot) blockers.push("SNAPSHOT_MISSING");
  else if (!snapshotReceivedAt || nowMs - new Date(snapshotReceivedAt).getTime() > BACKUP_LIMITS.snapshotMaxAgeMs) blockers.push("SNAPSHOT_STALE");
  if (connectionStatus !== "ACTIVE") blockers.push("CONNECTION_NOT_ACTIVE");
  if (multisite) blockers.push("MULTISITE_UNSUPPORTED");
  if (snapshot?.multisite) blockers.push("MULTISITE_UNSUPPORTED");
  if (!storage?.ready) blockers.push(storage?.reason === "PRODUCTION_LOCAL_STORAGE" ? "STORAGE_NOT_CONFIGURED_FOR_PRODUCTION" : "STORAGE_UNAVAILABLE");
  if (!encryption?.ready) blockers.push("ENCRYPTION_NOT_CONFIGURED");
  if (operationType !== "BACKUP" && conflictingJobs.length > 0) blockers.push("CONFLICTING_JOB_ACTIVE");
  if (mode === "SITE_DATA_BACKUP" && snapshot?.wordpressVersion == null) warnings.push("WORDPRESS_VERSION_UNKNOWN");
  if (operationType === "MIGRATION") {
    if (sourceSnapshot && destinationSnapshot) {
      if (sourceSnapshot.phpVersion && destinationSnapshot.phpVersion && sourceSnapshot.phpVersion !== destinationSnapshot.phpVersion) {
        warnings.push("PHP_VERSION_DIFFERS");
      }
      if (sourceSnapshot.wordpressVersion && destinationSnapshot.wordpressVersion && sourceSnapshot.wordpressVersion !== destinationSnapshot.wordpressVersion) {
        warnings.push("WORDPRESS_VERSION_DIFFERS");
      }
      if (destinationSnapshot.multisite) blockers.push("DESTINATION_MULTISITE_UNSUPPORTED");
    } else {
      warnings.push("DESTINATION_COMPATIBILITY_UNKNOWN");
    }
  }
  return { ok: blockers.length === 0, blockers, warnings };
}
