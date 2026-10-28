// Tool 10 dry-run plans. A plan is a versioned, hashed, read-only
// preview: tables/files at risk, exclusions, URL/prefix differences,
// rollback requirement, and limitations. A dry-run NEVER modifies the
// target, and confirmation of one plan never authorizes another plan.
import { planHash } from "./confirmation.js";
import { canonicalHostFromUrl } from "./preflight.js";
export function buildRestorePlan({ artifact, targetWebsite, targetSnapshot }) {
  const manifest = artifact.manifest ?? {};
  const targetHost = canonicalHostFromUrl(targetWebsite.normalizedUrl);
  const plan = {
    version: 1, operationType: "RESTORE",
    backupId: artifact.id, backupCreatedAt: artifact.createdAt?.toISOString?.() ?? artifact.createdAt,
    sourceWebsiteId: artifact.sourceWebsiteId, sourceHost: manifest.siteIdentity?.canonicalHost ?? null,
    destinationWebsiteId: targetWebsite.id, destinationHost: targetHost,
    mode: manifest.mode ?? artifact.mode,
    dbStrategy: manifest.mode === "FILES_ONLY" ? "NO_DB_CHANGE" : "REPLACE_TABLES_IN_MANIFEST",
    fileStrategy: manifest.mode === "DATABASE_ONLY" ? "NO_FILE_CHANGE" : "OVERWRITE_FILES_IN_SCOPE_ONLY",
    tablesAtRisk: manifest.mode === "FILES_ONLY" ? [] : ["tables listed in the backup manifest (exact table names are validated from trusted manifest metadata at execution time, never from browser input)"],
    fileCategoriesAtRisk: manifest.includedCategories ?? [],
    excludedCategories: manifest.excludedCategories ?? [],
    wpConfigHandling: manifest.includesWpConfig ? "SOURCE_WP_CONFIG_NEVER_OVERWRITES_DESTINATION" : "DESTINATION_WP_CONFIG_PRESERVED",
    urlDifference: manifest.siteIdentity?.canonicalHost && targetHost && manifest.siteIdentity.canonicalHost !== targetHost
      ? { from: manifest.siteIdentity.canonicalHost, to: targetHost, strategy: "SERIALIZATION_AWARE_REWRITE_SUPPORTED_TYPES_ONLY" } : null,
    tablePrefixDifference: manifest.tablePrefix ? { sourcePrefix: manifest.tablePrefix, note: "Prefix differences must be resolved before execution; unresolved differences block execution." } : null,
    rollbackBackupRequired: true,
    rollbackBackupId: null, // must be created + verified before any mutation; execution is BLOCKED in M14 (see docs)
    limitations: [
      "Live restore execution is NOT implemented in Milestone 14: confirming this plan does not modify the target.",
      "No atomicity claim for any future restore: DB import + file transfer cannot be atomic as a whole.",
      ...(manifest.limitations ?? []),
    ],
    verificationStrategy: ["manifest + archive integrity verified", "target identity re-checked", "post-restore site response + key checksums (future execution only)"],
  };
  return { plan, hash: planHash(plan) };
}
export function buildMigrationPlan({ sourceWebsite, destinationWebsite, sourceArtifact, destinationRollbackArtifact, sourceSnapshot, destinationSnapshot }) {
  const sourceHost = canonicalHostFromUrl(sourceWebsite.normalizedUrl);
  const destinationHost = canonicalHostFromUrl(destinationWebsite.normalizedUrl);
  const plan = {
    version: 1, operationType: "MIGRATION",
    sourceWebsiteId: sourceWebsite.id, sourceHost,
    destinationWebsiteId: destinationWebsite.id, destinationHost,
    sourceBackupId: sourceArtifact?.id ?? null,
    destinationRollbackBackupId: destinationRollbackArtifact?.id ?? null,
    included: sourceArtifact?.manifest?.includedCategories ?? [],
    excludedCategories: [...(sourceArtifact?.manifest?.excludedCategories ?? []), "destination wp-config.php, DB credentials, secret keys/salts, hosting config, SSH/host secrets (never copied)"],
    dbStrategy: "REPLACE_DESTINATION_TABLES_IN_MANIFEST_SCOPE",
    urlRewriteStrategy: "SERIALIZATION_AWARE_REWRITE_SUPPORTED_TYPES_ONLY",
    urlDifference: sourceHost !== destinationHost ? { from: sourceHost, to: destinationHost } : null,
    compatibility: {
      sourceWordPress: sourceSnapshot?.wordpressVersion ?? null,
      destinationWordPress: destinationSnapshot?.wordpressVersion ?? null,
      sourcePhp: sourceSnapshot?.phpVersion ?? null,
      destinationPhp: destinationSnapshot?.phpVersion ?? null,
      versionsMatch: Boolean(sourceSnapshot?.wordpressVersion && sourceSnapshot.wordpressVersion === destinationSnapshot?.wordpressVersion),
    },
    destinationDataAtRisk: "All destination tables/files inside the approved plan scope will be replaced; data outside the scope is not deleted by the plan.",
    downtime: "Destination may be inconsistent until verification completes; no atomicity is claimed.",
    rollbackPlan: destinationRollbackArtifact ? "Restore the verified destination rollback backup (manual steps in docs; automatic rollback is not implemented in M14)." : "NO ROLLBACK BACKUP — migration must not proceed until one is created and verified.",
    limitations: [
      "Live migration execution is NOT implemented in Milestone 14: confirming this plan does not modify the destination and never deletes the source.",
      "Unsupported serialized/object formats are skipped with explicit limitations, never rewritten blindly.",
      "Source health warnings from Tools 06-09 are advisory: migrating a suspicious source can reproduce its problems on the destination.",
    ],
    verificationStrategy: ["transfer integrity verified", "destination identity re-checked", "post-migration site response + key checksums (future execution only)"],
  };
  return { plan, hash: planHash(plan) };
}
