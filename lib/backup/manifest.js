// Tool 10 backup manifest v1. A manifest is a bounded, machine-readable
// description of an archive — never the archive contents, never secrets,
// never storage credentials, never private URLs. Integrity = SHA-256
// over the canonical manifest JSON (without its own integrity field)
// plus SHA-256 of the archive bytes; both are verified before any
// restore is even planned, and tampering fails closed.
import { sha256Hex } from "./crypto.js";
import { BACKUP_LIMITS, MANIFEST_VERSION, ARCHIVE_FORMAT } from "./limits.js";
import { BACKUP_MODES } from "./states.js";
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}
export function buildManifest(fields) {
  const manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: MANIFEST_VERSION,
    backupId: fields.backupId,
    ownerUserId: fields.ownerUserId,
    websiteId: fields.websiteId,
    siteIdentity: { canonicalHost: fields.canonicalHost, homeUrl: fields.homeUrl ?? null },
    mode: fields.mode,
    createdAt: fields.createdAt ?? new Date().toISOString(),
    connectorVersion: fields.connectorVersion ?? null,
    connectorSchemaVersion: fields.connectorSchemaVersion ?? null,
    wordpressVersion: fields.wordpressVersion ?? null,
    phpVersion: fields.phpVersion ?? null,
    dbEngine: fields.dbEngine ?? null,
    dbVersion: fields.dbVersion ?? null,
    multisite: Boolean(fields.multisite),
    tablePrefix: fields.tablePrefix ?? null,
    includedCategories: fields.includedCategories ?? [],
    excludedCategories: fields.excludedCategories ?? [],
    skippedFiles: fields.skippedFiles ?? [],
    tableCount: fields.tableCount ?? 0,
    rowCount: fields.rowCount ?? null,
    fileCount: fields.fileCount ?? 0,
    estimatedBytes: fields.estimatedBytes ?? null,
    archiveBytes: fields.archiveBytes ?? null,
    coverage: fields.coverage ?? {},
    limitations: fields.limitations ?? [],
    includesWpConfig: Boolean(fields.includesWpConfig),
    encryption: fields.encryption ?? null, // {scheme, version, keyId} — never the key
    verificationStatus: fields.verificationStatus ?? "UNVERIFIED",
  };
  manifest.integrity = { manifestSha256: sha256Hex(canonicalJson(manifest)), archiveSha256: fields.archiveSha256 ?? null };
  return manifest;
}
export function verifyManifestIntegrity(manifest) {
  if (!manifest || typeof manifest !== "object") return { ok: false, error: "MANIFEST_INVALID" };
  const { integrity, ...rest } = manifest;
  if (!integrity || typeof integrity.manifestSha256 !== "string") return { ok: false, error: "MANIFEST_INTEGRITY_MISSING" };
  return sha256Hex(canonicalJson(rest)) === integrity.manifestSha256
    ? { ok: true }
    : { ok: false, error: "MANIFEST_TAMPERED" };
}
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return { ok: false, errors: ["MANIFEST_INVALID"] };
  if (manifest.format !== ARCHIVE_FORMAT) errors.push("UNSUPPORTED_ARCHIVE_FORMAT");
  if (manifest.formatVersion !== MANIFEST_VERSION) errors.push("UNSUPPORTED_ARCHIVE_VERSION");
  if (!BACKUP_MODES.includes(manifest.mode)) errors.push("INVALID_MODE");
  if (typeof manifest.backupId !== "string" || !manifest.backupId) errors.push("MISSING_BACKUP_ID");
  if (typeof manifest.ownerUserId !== "string" || !manifest.ownerUserId) errors.push("MISSING_OWNER");
  if (typeof manifest.websiteId !== "string" || !manifest.websiteId) errors.push("MISSING_WEBSITE");
  if (!manifest.siteIdentity || typeof manifest.siteIdentity.canonicalHost !== "string" || !manifest.siteIdentity.canonicalHost) errors.push("MISSING_SITE_IDENTITY");
  if (manifest.multisite) errors.push("MULTISITE_UNSUPPORTED");
  if (typeof manifest.fileCount !== "number" || manifest.fileCount < 0) errors.push("INVALID_FILE_COUNT");
  if (typeof manifest.tableCount !== "number" || manifest.tableCount < 0) errors.push("INVALID_TABLE_COUNT");
  if (manifest.archiveBytes !== null && manifest.archiveBytes !== undefined && (typeof manifest.archiveBytes !== "number" || manifest.archiveBytes > BACKUP_LIMITS.maxArchiveBytes)) errors.push("ARCHIVE_TOO_LARGE");
  const integrity = verifyManifestIntegrity(manifest);
  if (!integrity.ok) errors.push(integrity.error);
  if (JSON.stringify(manifest).length > BACKUP_LIMITS.maxManifestBytes) errors.push("MANIFEST_TOO_LARGE");
  return { ok: errors.length === 0, errors };
}
