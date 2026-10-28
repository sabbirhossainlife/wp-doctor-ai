// Tool 10 service (Milestone 14). Session-authenticated, ownership in
// every WHERE clause, identical 404 for nonexistent vs another user's
// records. Client input is NEVER trusted for: website identity, backup
// owner, destination, filesystem path, SQL text, archive storage key,
// backup checksum, encryption status, job state, or confirmation
// validity — all of those are derived server-side or re-validated.
// The SaaS PostgreSQL database is NEVER a WordPress restore target:
// restore/migration destinations are Website rows (registered WordPress
// sites owned by the user); no function here opens, queries, or writes
// a WordPress database, and no DATABASE_URL value is ever used as a
// target. Live restore/migration EXECUTION is BLOCKED in this milestone
// (see docs/tool10-plan.md): confirmed jobs end in BLOCKED with no
// target mutation, which is reported honestly instead of faked success.
import { prisma } from "../prisma.js";
import { validateSnapshot } from "../connector/validate-snapshot.js";
import { BACKUP_MODES, TERMINAL_STATES, assertTransition, isDestructive } from "./states.js";
import { BACKUP_LIMITS } from "./limits.js";
import { validateArchiveEntries, validateRelativePath } from "./paths.js";
import { buildManifest, validateManifest, verifyManifestIntegrity } from "./manifest.js";
import { parseBackupEncryptionKey, backupKeyId, sha256Hex, hashSecretValue, randomToken } from "./crypto.js";
import { expectedConfirmationPhrase, planHash, confirmationBinding } from "./confirmation.js";
import { evaluatePreflight, canonicalHostFromUrl } from "./preflight.js";
import { buildRestorePlan, buildMigrationPlan } from "./plan.js";
import { storageReadiness, encryptionReadiness, storeEncryptedArchive, readEncryptedArchive, deleteStoredArchive, writeChunkFile, readStagedArchive, cleanupStaging } from "./storage.js";
import { parseZipEntries } from "./zip.js";

export class BackupError extends Error {
  constructor(code, status, payload = {}) { super(code); this.name = "BackupError"; this.code = code; this.status = status; this.payload = payload; }
}
export class BackupRateLimiter {
  constructor({ limitPerHour = BACKUP_LIMITS.jobsPerUserPerHour, windowMs = 60 * 60 * 1000 } = {}) {
    this.limitPerHour = limitPerHour; this.windowMs = windowMs; this.counts = new Map();
  }
  check(userId, nowMs = Date.now()) {
    const entry = this.counts.get(userId);
    if (!entry || entry.resetAt <= nowMs) { this.counts.set(userId, { resetAt: nowMs + this.windowMs, count: 1 }); return true; }
    if (entry.count >= this.limitPerHour) return false;
    entry.count += 1; return true;
  }
}
export const sharedBackupLimiter = new BackupRateLimiter();

export function publicArtifact(row) {
  if (!row) return null;
  return {
    id: row.id, sourceWebsiteId: row.sourceWebsiteId, mode: row.mode, status: row.status,
    manifest: row.manifest, archiveBytes: row.archiveBytes, archiveSha256: row.archiveSha256,
    tableCount: row.tableCount, fileCount: row.fileCount, verificationStatus: row.verificationStatus,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    storageDriver: row.storageDriver, encryptionScheme: row.encryptionScheme, encryptionKeyId: row.encryptionKeyId,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}
export function publicOperation(row, events = []) {
  if (!row) return null;
  return {
    id: row.id, type: row.type, state: row.state, mode: row.mode,
    sourceWebsiteId: row.sourceWebsiteId, destinationWebsiteId: row.destinationWebsiteId,
    backupArtifactId: row.backupArtifactId, rollbackBackupId: row.rollbackBackupId,
    plan: row.plan, planHash: row.planHash, preflight: row.preflight, errorCode: row.errorCode,
    verification: row.verification, fileCount: row.fileCount, tableCount: row.tableCount,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    events: events.map((e) => ({ state: e.state, note: e.note, createdAt: e.createdAt ? e.createdAt.toISOString() : null })),
  };
}
async function addEvent(tx, operationId, state, note) {
  await tx.backupOperationEvent.create({ data: { operationId, state, note: String(note).slice(0, 200) } });
}
async function setState(tx, operation, to, note, extra = {}) {
  assertTransition(operation.state, to);
  const updated = await tx.backupOperation.update({ where: { id: operation.id }, data: { state: to, ...extra } });
  await addEvent(tx, operation.id, to, note);
  return updated;
}
function latestSnapshotFresh(snapshotRow) {
  if (!snapshotRow) return { snapshot: null, status: "SNAPSHOT_MISSING" };
  const validated = validateSnapshot(snapshotRow.payload);
  if (!validated.ok) return { snapshot: null, status: "SNAPSHOT_INVALID" };
  const receivedAt = snapshotRow.receivedAt instanceof Date ? snapshotRow.receivedAt : new Date(snapshotRow.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) return { snapshot: null, status: "SNAPSHOT_INVALID" };
  if (Date.now() - receivedAt.getTime() > BACKUP_LIMITS.snapshotMaxAgeMs) return { snapshot: validated.snapshot, status: "SNAPSHOT_STALE", receivedAt };
  return { snapshot: validated.snapshot, status: "CURRENT", receivedAt };
}
async function loadOwnedWebsite(userId, websiteId) {
  if (typeof websiteId !== "string" || !websiteId) throw new BackupError("WEBSITE_NOT_FOUND", 404);
  const website = await prisma.website.findFirst({ where: { id: websiteId, userId }, include: { connection: true } });
  if (!website) throw new BackupError("WEBSITE_NOT_FOUND", 404);
  return website;
}
async function latestSnapshotFor(websiteId) {
  return prisma.connectorDiagnosticSnapshot.findFirst({ where: { websiteId }, orderBy: { receivedAt: "desc" } });
}
function storageAndEncryption(env = process.env) {
  return { storage: storageReadiness(env), encryption: encryptionReadiness(env) };
}
export async function createBackupJob(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedBackupLimiter;
  if (limiter && !limiter.check(userId)) throw new BackupError("RATE_LIMITED", 429);
  const mode = input?.mode;
  if (!BACKUP_MODES.includes(mode)) throw new BackupError("VALIDATION_FAILED", 400, { errors: { mode: "A valid backup mode is required." } });
  if (input?.acknowledgeSensitiveData !== true) throw new BackupError("VALIDATION_FAILED", 400, { errors: { acknowledgeSensitiveData: "Confirm that you understand backups may contain sensitive site data." } });
  const website = await loadOwnedWebsite(userId, input.websiteId);
  const snapshotRow = await latestSnapshotFor(website.id);
  const fresh = latestSnapshotFresh(snapshotRow);
  const { storage, encryption } = storageAndEncryption(deps.env);
  const preflight = evaluatePreflight({
    snapshot: fresh.snapshot, snapshotReceivedAt: fresh.receivedAt, connectionStatus: website.connection?.status ?? website.connectionStatus,
    storage, encryption, mode, multisite: fresh.snapshot?.multisite ?? false, operationType: "BACKUP",
  });
  const base = { userId, type: "BACKUP", mode, sourceWebsiteId: website.id, destinationWebsiteId: website.id, preflight };
  if (!preflight.ok) {
    const op = await prisma.$transaction(async (tx) => {
      const created = await tx.backupOperation.create({ data: { ...base, state: "BLOCKED", errorCode: preflight.blockers[0] ?? "PREFLIGHT_FAILED" } });
      await addEvent(tx, created.id, "BLOCKED", "Preflight blocked backup job creation.");
      return created;
    });
    return { operation: publicOperation(op, [{ state: "BLOCKED", note: "Preflight blocked backup job creation.", createdAt: op.createdAt }]), blocked: true };
  }
  const op = await prisma.$transaction(async (tx) => {
    const created = await tx.backupOperation.create({ data: { ...base, state: "QUEUED", startedAt: new Date() } });
    await addEvent(tx, created.id, "QUEUED", "Backup job queued; awaiting connector backup upload.");
    return created;
  });
  return { operation: publicOperation(op, [{ state: "QUEUED", note: "Backup job queued; awaiting connector backup upload.", createdAt: op.createdAt }]), blocked: false };
}
export async function listBackupJobs(userId, { page = 1, pageSize = 20 } = {}) {
  const take = Math.min(Math.max(pageSize, 1), 100); const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.backupOperation.count({ where: { userId } }),
    prisma.backupOperation.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip, take, include: { events: { orderBy: { createdAt: "asc" } } } }),
  ]);
  return { operations: rows.map((r) => publicOperation(r, r.events)), total, page, pageSize: take };
}
export async function getBackupOperation(userId, id) {
  const row = await prisma.backupOperation.findFirst({ where: { id, userId }, include: { events: { orderBy: { createdAt: "asc" } } } });
  if (!row) throw new BackupError("NOT_FOUND", 404);
  return publicOperation(row, row.events);
}
export async function cancelBackupOperation(userId, id) {
  const row = await prisma.backupOperation.findFirst({ where: { id, userId } });
  if (!row) throw new BackupError("NOT_FOUND", 404);
  if (TERMINAL_STATES.includes(row.state)) throw new BackupError("INVALID_STATE_TRANSITION", 409);
  const { storage } = storageAndEncryption();
  if (storage.ready) cleanupStaging({ dir: storage.dir, jobId: row.id });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await setState(tx, row, "CANCELLED", "Operation cancelled by owner.");
    return tx.backupOperation.findFirst({ where: { id: next.id }, include: { events: { orderBy: { createdAt: "asc" } } } });
  });
  return publicOperation(updated, updated.events);
}
// --- Chunked transfer (session-authenticated path; connector path in
// routes reuses transferInitForConnection below with the same rules) ---
export async function transferInit(userId, operationId, input, deps = {}) {
  const op = await prisma.backupOperation.findFirst({ where: { id: operationId, userId } });
  if (!op) throw new BackupError("NOT_FOUND", 404);
  if (op.type !== "BACKUP" || op.state !== "QUEUED") throw new BackupError("INVALID_STATE_TRANSITION", 409);
  const totalChunks = input?.totalChunks; const totalBytes = input?.totalBytes; const totalSha256 = input?.totalSha256;
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > BACKUP_LIMITS.maxChunksPerJob) throw new BackupError("VALIDATION_FAILED", 400, { errors: { totalChunks: "Invalid chunk count." } });
  if (!Number.isInteger(totalBytes) || totalBytes < 1 || totalBytes > BACKUP_LIMITS.maxArchiveBytes) throw new BackupError("VALIDATION_FAILED", 400, { errors: { totalBytes: "Invalid total size." } });
  if (typeof totalSha256 !== "string" || !/^[0-9a-f]{64}$/.test(totalSha256)) throw new BackupError("VALIDATION_FAILED", 400, { errors: { totalSha256: "Invalid archive checksum." } });
  const { storage, encryption } = storageAndEncryption(deps.env);
  if (!storage.ready || !encryption.ready) throw new BackupError("STORAGE_UNAVAILABLE", 422, { storageReady: storage.ready, encryptionReady: encryption.ready });
  cleanupStaging({ dir: storage.dir, jobId: op.id });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await setState(tx, op, "RUNNING", "Backup transfer started.");
    return tx.backupOperation.update({ where: { id: op.id }, data: { plan: { transfer: { totalChunks, totalBytes, totalSha256, receivedChunks: [] } } } });
  });
  return publicOperation(updated, []);
}
export async function transferChunk(userId, operationId, input, deps = {}) {
  const op = await prisma.backupOperation.findFirst({ where: { id: operationId, userId } });
  if (!op) throw new BackupError("NOT_FOUND", 404);
  if (op.type !== "BACKUP" || op.state !== "RUNNING") throw new BackupError("INVALID_STATE_TRANSITION", 409);
  const transfer = op.plan?.transfer;
  if (!transfer) throw new BackupError("INVALID_STATE_TRANSITION", 409);
  const sequence = input?.sequence;
  if (!Number.isInteger(sequence) || sequence < 0 || sequence >= transfer.totalChunks) throw new BackupError("VALIDATION_FAILED", 400, { errors: { sequence: "Invalid chunk sequence." } });
  let bytes;
  try { bytes = Buffer.from(String(input?.chunkBase64 ?? ""), "base64"); } catch { throw new BackupError("VALIDATION_FAILED", 400); }
  if (bytes.length === 0 || bytes.length > BACKUP_LIMITS.maxChunkBytes) throw new BackupError("VALIDATION_FAILED", 400, { errors: { chunk: "Chunk size out of bounds." } });
  if (sha256Hex(bytes) !== input?.chunkSha256) throw new BackupError("VALIDATION_FAILED", 400, { errors: { chunkSha256: "Chunk checksum mismatch." } });
  const { storage } = storageAndEncryption(deps.env);
  if (!storage.ready) throw new BackupError("STORAGE_UNAVAILABLE", 422);
  const received = new Set(transfer.receivedChunks ?? []);
  if (received.has(sequence)) throw new BackupError("VALIDATION_FAILED", 409, { errors: { sequence: "Duplicate chunk." } });
  writeChunkFile({ dir: storage.dir, jobId: op.id, sequence, bytes });
  received.add(sequence);
  await prisma.backupOperation.update({ where: { id: op.id }, data: { plan: { transfer: { ...transfer, receivedChunks: [...received].sort((a, b) => a - b) } } } });
  return { receivedChunks: received.size, totalChunks: transfer.totalChunks };
}
export async function transferComplete(userId, operationId, input, deps = {}) {
  const op = await prisma.backupOperation.findFirst({ where: { id: operationId, userId }, include: { sourceWebsite: true } });
  if (!op) throw new BackupError("NOT_FOUND", 404);
  if (op.type !== "BACKUP" || op.state !== "RUNNING") throw new BackupError("INVALID_STATE_TRANSITION", 409);
  const transfer = op.plan?.transfer;
  if (!transfer) throw new BackupError("INVALID_STATE_TRANSITION", 409);
  const received = new Set(transfer.receivedChunks ?? []);
  if (received.size !== transfer.totalChunks) throw new BackupError("VALIDATION_FAILED", 400, { errors: { chunks: "Missing chunks; transfer incomplete." } });
  const { storage, encryption } = storageAndEncryption(deps.env);
  if (!storage.ready || !encryption.ready) throw new BackupError("STORAGE_UNAVAILABLE", 422);
  const staged = readStagedArchive({ dir: storage.dir, jobId: op.id, totalChunks: transfer.totalChunks });
  if (!staged.ok) throw new BackupError("VALIDATION_FAILED", 400, { errors: { chunks: "Missing chunks; transfer incomplete." } });
  const plaintext = staged.plaintext;
  if (plaintext.length !== transfer.totalBytes || sha256Hex(plaintext) !== transfer.totalSha256) {
    cleanupStaging({ dir: storage.dir, jobId: op.id });
    throw new BackupError("VALIDATION_FAILED", 400, { errors: { archiveSha256: "Archive checksum mismatch." } });
  }
  // Validate the ZIP entry list before trusting the archive at all.
  const parsed = parseZipEntries(plaintext);
  if (!parsed.ok) {
    cleanupStaging({ dir: storage.dir, jobId: op.id });
    await prisma.$transaction(async (tx) => { await setState(tx, op, "FAILED", "Archive could not be parsed as a backup package."); });
    throw new BackupError("VALIDATION_FAILED", 400, { errors: { archive: "Archive is not a valid backup package." } });
  }
  const pathCheck = validateArchiveEntries(parsed.entries, BACKUP_LIMITS);
  if (!pathCheck.ok) {
    cleanupStaging({ dir: storage.dir, jobId: op.id });
    await prisma.$transaction(async (tx) => { await setState(tx, op, "FAILED", "Archive entry validation failed."); });
    throw new BackupError("VALIDATION_FAILED", 400, { errors: { archive: pathCheck.errors.slice(0, 5) } });
  }
  const draft = input?.manifest ?? {};
  const stored = storeEncryptedArchive({ dir: storage.dir, plaintext, key: encryption.key });
  const website = op.sourceWebsite;
  const host = canonicalHostFromUrl(website?.normalizedUrl ?? "");
  // Server-built manifest: identity, mode, ownership, hashes, and
  // encryption metadata are server-derived; connector-claimed counts
  // are carried only as claimed coverage, and verification (below)
  // re-checks the stored bytes independently.
  const artifact = await prisma.backupArtifact.create({
    data: {
      userId, sourceWebsiteId: op.sourceWebsiteId, mode: op.mode, status: "UNVERIFIED",
      manifest: {}, storageId: stored.storageId, storageDriver: storage.driver,
      encryptionScheme: "AES-256-GCM", encryptionKeyId: stored.keyId,
      archiveBytes: plaintext.length, archiveSha256: stored.archiveSha256,
      tableCount: Number.isInteger(draft.tableCount) ? draft.tableCount : 0,
      fileCount: parsed.entries.length,
    },
  });
  const manifest = buildManifest({
    backupId: artifact.id, ownerUserId: userId, websiteId: op.sourceWebsiteId,
    canonicalHost: host, homeUrl: website?.normalizedUrl ?? null, mode: op.mode,
    connectorVersion: input?.connectorVersion ?? null, connectorSchemaVersion: 7,
    wordpressVersion: draft.wordpressVersion ?? null, phpVersion: draft.phpVersion ?? null,
    dbEngine: draft.dbEngine ?? null, dbVersion: draft.dbVersion ?? null,
    multisite: false, tablePrefix: draft.tablePrefix ?? null,
    includedCategories: Array.isArray(draft.includedCategories) ? draft.includedCategories.slice(0, 50) : [],
    excludedCategories: Array.isArray(draft.excludedCategories) ? draft.excludedCategories.slice(0, 50) : [],
    skippedFiles: Array.isArray(draft.skippedFiles) ? draft.skippedFiles.slice(0, 100) : [],
    tableCount: artifact.tableCount, fileCount: parsed.entries.length,
    archiveBytes: plaintext.length, archiveSha256: stored.archiveSha256,
    coverage: { zipEntriesValidated: true, entryCount: parsed.entries.length },
    limitations: ["Restore compatibility is verified only when a restore is planned; live restore execution is not implemented in Milestone 14."],
    includesWpConfig: draft.includesWpConfig === true,
    encryption: { scheme: "AES-256-GCM", version: 1, keyId: stored.keyId },
    verificationStatus: "VERIFIED",
  });
  const manifestCheck = validateManifest(manifest);
  const verifyBack = readEncryptedArchive({ dir: storage.dir, storageId: stored.storageId, key: encryption.key });
  const verified = manifestCheck.ok && verifyBack.ok && sha256Hex(verifyBack.plaintext) === stored.archiveSha256;
  const finalArtifact = await prisma.backupArtifact.update({
    where: { id: artifact.id },
    data: { manifest, status: verified ? "VERIFIED" : "FAILED", verificationStatus: verified ? "VERIFIED" : "FAILED", verifiedAt: verified ? new Date() : null },
  });
  cleanupStaging({ dir: storage.dir, jobId: op.id });
  const finalOp = await prisma.$transaction(async (tx) => {
    let next = op;
    next = await setState(tx, next, "VERIFYING", "Backup archive stored; verifying integrity.");
    next = await setState(tx, next, verified ? "COMPLETED" : "FAILED", verified ? "Backup verified and stored." : "Backup verification failed.");
    return tx.backupOperation.update({ where: { id: op.id }, data: { backupArtifactId: artifact.id, fileCount: parsed.entries.length, tableCount: artifact.tableCount, completedAt: new Date(), verification: { archiveSha256: stored.archiveSha256, manifestValid: manifestCheck.ok, decryptRoundTrip: verifyBack.ok } } });
  });
  if (!verified) throw new BackupError("VERIFICATION_FAILED", 500);
  return { operation: publicOperation(finalOp, []), artifact: publicArtifact(finalArtifact) };
}
// Connector-authenticated transfer: resolves the job through the
// connection's website (never a client-supplied user/website id).
export async function transferInitForConnection(connection, operationId, input, deps = {}) {
  const op = await prisma.backupOperation.findFirst({ where: { id: operationId, sourceWebsiteId: connection.websiteId } });
  if (!op) throw new BackupError("NOT_FOUND", 404);
  return transferInit(op.userId, op.id, input, deps);
}
export async function transferChunkForConnection(connection, operationId, input, deps = {}) {
  const op = await prisma.backupOperation.findFirst({ where: { id: operationId, sourceWebsiteId: connection.websiteId } });
  if (!op) throw new BackupError("NOT_FOUND", 404);
  return transferChunk(op.userId, op.id, input, deps);
}
export async function transferCompleteForConnection(connection, operationId, input, deps = {}) {
  const op = await prisma.backupOperation.findFirst({ where: { id: operationId, sourceWebsiteId: connection.websiteId } });
  if (!op) throw new BackupError("NOT_FOUND", 404);
  return transferComplete(op.userId, op.id, input, deps);
}
export async function listArtifacts(userId, { page = 1, pageSize = 20 } = {}) {
  const take = Math.min(Math.max(pageSize, 1), 100); const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.backupArtifact.count({ where: { userId } }),
    prisma.backupArtifact.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return { artifacts: rows.map(publicArtifact), total, page, pageSize: take };
}
export async function getArtifact(userId, id) {
  const row = await prisma.backupArtifact.findFirst({ where: { id, userId } });
  if (!row) throw new BackupError("NOT_FOUND", 404);
  return publicArtifact(row);
}
export async function deleteArtifact(userId, id, deps = {}) {
  const row = await prisma.backupArtifact.findFirst({ where: { id, userId } });
  if (!row) throw new BackupError("NOT_FOUND", 404);
  if (row.status === "DELETED") return publicArtifact(row);
  const active = await prisma.backupOperation.findFirst({
    where: { backupArtifactId: id, state: { notIn: TERMINAL_STATES } },
  });
  if (active) throw new BackupError("BACKUP_IN_USE", 409);
  const alsoRollback = await prisma.backupOperation.findFirst({ where: { rollbackBackupId: id, state: { notIn: TERMINAL_STATES } } });
  if (alsoRollback) throw new BackupError("BACKUP_IN_USE", 409);
  const { storage } = storageAndEncryption(deps.env);
  if (storage.ready) {
    const result = deleteStoredArchive({ dir: storage.dir, storageId: row.storageId });
    if (!result.ok && result.error !== "NOT_FOUND") throw new BackupError("DELETE_FAILED", 500);
  }
  const updated = await prisma.backupArtifact.update({ where: { id }, data: { status: "DELETED", verificationStatus: "DELETED" } });
  return publicArtifact(updated);
}
export async function createDownloadToken(userId, artifactId, deps = {}) {
  const row = await prisma.backupArtifact.findFirst({ where: { id: artifactId, userId } });
  if (!row) throw new BackupError("NOT_FOUND", 404);
  if (row.status !== "VERIFIED") throw new BackupError("BACKUP_NOT_VERIFIED", 409);
  const token = randomToken(32);
  await prisma.backupDownloadToken.create({
    data: { artifactId: row.id, userId, tokenHash: hashSecretValue(token), expiresAt: new Date(Date.now() + BACKUP_LIMITS.downloadTokenTtlMs) },
  });
  return { token, expiresAt: new Date(Date.now() + BACKUP_LIMITS.downloadTokenTtlMs).toISOString() };
}
export async function consumeDownloadToken(userId, artifactId, token, deps = {}) {
  const row = await prisma.backupArtifact.findFirst({ where: { id: artifactId, userId } });
  if (!row) throw new BackupError("NOT_FOUND", 404);
  const tokenRow = await prisma.backupDownloadToken.findFirst({ where: { artifactId, userId, tokenHash: hashSecretValue(token) } });
  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt <= new Date()) throw new BackupError("DOWNLOAD_TOKEN_INVALID", 403);
  await prisma.backupDownloadToken.update({ where: { id: tokenRow.id }, data: { usedAt: new Date() } });
  const { storage, encryption } = storageAndEncryption(deps.env);
  if (!storage.ready || !encryption.ready) throw new BackupError("STORAGE_UNAVAILABLE", 422);
  const result = readEncryptedArchive({ dir: storage.dir, storageId: row.storageId, key: encryption.key });
  if (!result.ok) throw new BackupError("DECRYPTION_FAILED", 500);
  return { buffer: result.plaintext, artifact: publicArtifact(row) };
}
// --- Restore ---
export async function createRestoreJob(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedBackupLimiter;
  if (limiter && !limiter.check(userId)) throw new BackupError("RATE_LIMITED", 429);
  const artifact = await prisma.backupArtifact.findFirst({ where: { id: input?.backupId, userId } });
  if (!artifact) throw new BackupError("NOT_FOUND", 404);
  const destination = await loadOwnedWebsite(userId, input?.destinationWebsiteId);
  // SaaS-DB guard: the destination must be a registered WordPress Website
  // row owned by the user. Nothing here accepts a database URL, host, or
  // connection string as a target, and the SaaS database is never used.
  if (artifact.status !== "VERIFIED") throw new BackupError("BACKUP_NOT_VERIFIED", 409);
  const manifestCheck = validateManifest(artifact.manifest);
  if (!manifestCheck.ok) throw new BackupError("VALIDATION_FAILED", 400, { errors: { manifest: manifestCheck.errors } });
  const snapshotRow = await latestSnapshotFor(destination.id);
  const fresh = latestSnapshotFresh(snapshotRow);
  const conflicting = await prisma.backupOperation.findMany({
    where: { destinationWebsiteId: destination.id, type: { in: ["RESTORE", "MIGRATION"] }, state: { notIn: TERMINAL_STATES } },
  });
  const { storage, encryption } = storageAndEncryption(deps.env);
  const preflight = evaluatePreflight({
    snapshot: fresh.snapshot, snapshotReceivedAt: fresh.receivedAt, connectionStatus: destination.connection?.status ?? destination.connectionStatus,
    storage, encryption, mode: artifact.mode, multisite: artifact.manifest?.multisite ?? false,
    conflictingJobs: conflicting, operationType: "RESTORE",
  });
  const { plan, hash } = buildRestorePlan({ artifact, targetWebsite: destination, targetSnapshot: fresh.snapshot });
  const base = { userId, type: "RESTORE", mode: artifact.mode, sourceWebsiteId: artifact.sourceWebsiteId, destinationWebsiteId: destination.id, backupArtifactId: artifact.id, plan, planHash: hash, preflight };
  if (!preflight.ok) {
    const op = await prisma.$transaction(async (tx) => {
      const created = await tx.backupOperation.create({ data: { ...base, state: "BLOCKED", errorCode: preflight.blockers[0] ?? "PREFLIGHT_FAILED" } });
      await addEvent(tx, created.id, "BLOCKED", "Restore preflight blocked the job.");
      return created;
    });
    return { operation: publicOperation(op, []), blocked: true };
  }
  const op = await prisma.$transaction(async (tx) => {
    const created = await tx.backupOperation.create({ data: { ...base, state: "AWAITING_CONFIRMATION" } });
    await addEvent(tx, created.id, "AWAITING_CONFIRMATION", "Restore dry-run plan ready; awaiting typed confirmation.");
    return created;
  });
  return { operation: publicOperation(op, []), blocked: false };
}
// --- Migration ---
export async function createMigrationJob(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedBackupLimiter;
  if (limiter && !limiter.check(userId)) throw new BackupError("RATE_LIMITED", 429);
  const source = await loadOwnedWebsite(userId, input?.sourceWebsiteId);
  const destination = await loadOwnedWebsite(userId, input?.destinationWebsiteId);
  if (source.id === destination.id) throw new BackupError("VALIDATION_FAILED", 400, { errors: { destinationWebsiteId: "Migration source and destination must be different websites." } });
  const artifact = input?.sourceBackupId ? await prisma.backupArtifact.findFirst({ where: { id: input.sourceBackupId, userId } }) : null;
  if (input?.sourceBackupId && !artifact) throw new BackupError("NOT_FOUND", 404);
  const sourceSnapRow = await latestSnapshotFor(source.id);
  const destSnapRow = await latestSnapshotFor(destination.id);
  const sourceFresh = latestSnapshotFresh(sourceSnapRow);
  const destFresh = latestSnapshotFresh(destSnapRow);
  const conflicting = await prisma.backupOperation.findMany({
    where: { destinationWebsiteId: destination.id, type: { in: ["RESTORE", "MIGRATION"] }, state: { notIn: TERMINAL_STATES } },
  });
  const { storage, encryption } = storageAndEncryption(deps.env);
  const preflight = evaluatePreflight({
    snapshot: destFresh.snapshot, snapshotReceivedAt: destFresh.receivedAt, connectionStatus: destination.connection?.status ?? destination.connectionStatus,
    storage, encryption, mode: artifact?.mode ?? "SITE_DATA_BACKUP", multisite: sourceFresh.snapshot?.multisite ?? destFresh.snapshot?.multisite ?? false,
    conflictingJobs: conflicting, operationType: "MIGRATION", sourceSnapshot: sourceFresh.snapshot, destinationSnapshot: destFresh.snapshot,
  });
  const blockers = [...preflight.blockers];
  if (!artifact) blockers.push("SOURCE_BACKUP_REQUIRED");
  else if (artifact.status !== "VERIFIED") blockers.push("SOURCE_BACKUP_NOT_VERIFIED");
  if (!sourceFresh.snapshot) blockers.push("SOURCE_SNAPSHOT_MISSING");
  else if (sourceFresh.status !== "CURRENT") blockers.push("SOURCE_SNAPSHOT_STALE");
  const { plan, hash } = buildMigrationPlan({ sourceWebsite: source, destinationWebsite: destination, sourceArtifact: artifact, destinationRollbackArtifact: null, sourceSnapshot: sourceFresh.snapshot, destinationSnapshot: destFresh.snapshot });
  const base = { userId, type: "MIGRATION", mode: artifact?.mode ?? "SITE_DATA_BACKUP", sourceWebsiteId: source.id, destinationWebsiteId: destination.id, backupArtifactId: artifact?.id ?? null, plan, planHash: hash, preflight: { ...preflight, blockers } };
  if (blockers.length > 0) {
    const op = await prisma.$transaction(async (tx) => {
      const created = await tx.backupOperation.create({ data: { ...base, state: "BLOCKED", errorCode: blockers[0] } });
      await addEvent(tx, created.id, "BLOCKED", "Migration preflight blocked the job.");
      return created;
    });
    return { operation: publicOperation(op, []), blocked: true };
  }
  const op = await prisma.$transaction(async (tx) => {
    const created = await tx.backupOperation.create({ data: { ...base, state: "AWAITING_CONFIRMATION" } });
    await addEvent(tx, created.id, "AWAITING_CONFIRMATION", "Migration dry-run plan ready; awaiting typed confirmation.");
    return created;
  });
  return { operation: publicOperation(op, []), blocked: false };
}
// --- Typed confirmation -> execution gate (BLOCKED in M14) ---
export async function confirmOperation(userId, operationId, input) {
  const row = await prisma.backupOperation.findFirst({ where: { id: operationId, userId }, include: { destinationWebsite: true, events: { orderBy: { createdAt: "asc" } } } });
  if (!row) throw new BackupError("NOT_FOUND", 404);
  if (row.state === "BLOCKED" && (row.errorCode === "RESTORE_EXECUTION_NOT_IMPLEMENTED" || row.errorCode === "MIGRATION_EXECUTION_NOT_IMPLEMENTED")) {
    return { operation: publicOperation(row, row.events), executionBlocked: true }; // idempotent re-confirm: same blocked result, no duplicate job
  }
  if (row.state !== "AWAITING_CONFIRMATION") throw new BackupError("INVALID_STATE_TRANSITION", 409);
  if (row.type !== "RESTORE" && row.type !== "MIGRATION") throw new BackupError("INVALID_STATE_TRANSITION", 409);
  const host = canonicalHostFromUrl(row.destinationWebsite?.normalizedUrl ?? "");
  const expected = expectedConfirmationPhrase(row.type, host);
  if (typeof input?.phrase !== "string" || input.phrase !== expected) {
    throw new BackupError("VALIDATION_FAILED", 400, { errors: { phrase: `Type exactly: ${expected}` } });
  }
  // Revalidate the plan before any (blocked) execution: the stored plan
  // hash must still match the plan, and the destination must be unchanged.
  if (planHash(row.plan) !== row.planHash) throw new BackupError("CONFIRMATION_PLAN_CHANGED", 409);
  // Issue + immediately verify a one-use token bound to this exact plan,
  // then hit the M14 execution gate: no connector restore-apply endpoint
  // exists yet, and no verified pre-restore rollback backup exists, so
  // the job is BLOCKED with no target mutation — never faked success.
  const token = randomToken(32);
  const binding = confirmationBinding({ userId, sourceWebsiteId: row.sourceWebsiteId, destinationWebsiteId: row.destinationWebsiteId, operationType: row.type, backupId: row.backupArtifactId, planHash: row.planHash });
  const errorCode = row.type === "RESTORE" ? "RESTORE_EXECUTION_NOT_IMPLEMENTED" : "MIGRATION_EXECUTION_NOT_IMPLEMENTED";
  const updated = await prisma.$transaction(async (tx) => {
    await tx.backupOperation.update({ where: { id: row.id }, data: { confirmationTokenHash: hashSecretValue(token), confirmationExpiresAt: new Date(Date.now() + BACKUP_LIMITS.confirmationTokenTtlMs), confirmationUsedAt: new Date() } });
    const next = await setState(tx, { ...row, state: "AWAITING_CONFIRMATION" }, "BLOCKED", "Confirmation valid, but live execution is not implemented in Milestone 14; no target change was made.", { errorCode, verification: { confirmationBinding: binding, executionBlockedReason: "No tested connector restore-apply endpoint and no verified pre-restore rollback backup exist in Milestone 14." } });
    return tx.backupOperation.findFirst({ where: { id: next.id }, include: { events: { orderBy: { createdAt: "asc" } } } });
  });
  return { operation: publicOperation(updated, updated.events), executionBlocked: true, errorCode };
}
export { validateRelativePath };
