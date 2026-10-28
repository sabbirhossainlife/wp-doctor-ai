// Tool 10 bounded limits. Every limit is enforced on the server; a hit
// produces a PARTIAL or BLOCKED outcome with explicit coverage metadata,
// never a silent omission or a claim of completeness.
export const BACKUP_LIMITS = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024, // 512 MiB per archive
  maxExpandedBytes: 2 * 1024 * 1024 * 1024, // decompression-bomb guard
  maxFilesPerArchive: 50000,
  maxFileBytes: 256 * 1024 * 1024,
  maxChunkBytes: 1024 * 1024, // 1 MiB per transfer chunk
  maxChunksPerJob: 512,
  maxManifestBytes: 256 * 1024,
  maxTablesPerBackup: 10000,
  maxPlanBytes: 64 * 1024,
  snapshotMaxAgeMs: 24 * 60 * 60 * 1000, // same 24 h policy as Tools 02-09
  confirmationTokenTtlMs: 15 * 60 * 1000,
  downloadTokenTtlMs: 5 * 60 * 1000,
  jobsPerUserPerHour: 20,
  downloadsPerArtifactPerHour: 10,
});
export const MANIFEST_VERSION = 1;
export const ARCHIVE_FORMAT = "wp-doctor-ai-backup-zip-v1";
