// Tool 10 storage abstraction. ONLY a private local adapter is
// implemented (development/test). Production + local storage = BLOCKED
// (ephemeral disk is not a backup store); no S3/object adapter exists
// and none is claimed. Filenames are random IDs, never site/user names;
// stored blobs are AES-256-GCM ciphertext (see crypto.js); nothing here
// is ever served publicly and no storage path/credential reaches the
// browser.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { encryptArchive, decryptArchive, parseBackupEncryptionKey, backupKeyId, sha256Hex } from "./crypto.js";
export function storageReadiness(env = process.env) {
  const driver = (env.BACKUP_STORAGE_DRIVER ?? "local").trim().toLowerCase();
  if (driver !== "local") return { ready: false, reason: "UNSUPPORTED_STORAGE_DRIVER", driver };
  if (env.NODE_ENV === "production") return { ready: false, reason: "PRODUCTION_LOCAL_STORAGE", driver };
  const dir = (env.BACKUP_STORAGE_DIR ?? "").trim();
  if (!dir) return { ready: false, reason: "STORAGE_NOT_CONFIGURED", driver };
  return { ready: true, driver, dir };
}
export function encryptionReadiness(env = process.env) {
  const key = parseBackupEncryptionKey(env);
  if (!key) return { ready: false, key: null };
  return { ready: true, key, keyId: backupKeyId(key) };
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function artifactPath(dir, storageId) {
  const safe = /^[A-Za-z0-9_-]{16,128}$/.test(storageId) ? storageId : null;
  if (!safe) throw new Error("INVALID_STORAGE_ID");
  return path.join(dir, "artifacts", `${storageId}.enc`);
}
export function newStorageId() { return crypto.randomBytes(16).toString("hex"); }
export function storeEncryptedArchive({ dir, plaintext, key }) {
  ensureDir(path.join(dir, "artifacts"));
  const storageId = newStorageId();
  const { keyId, blob } = encryptArchive(plaintext, key);
  const file = artifactPath(dir, storageId);
  fs.writeFileSync(file, blob, { mode: 0o600 });
  return { storageId, keyId, storedBytes: blob.length, archiveSha256: sha256Hex(plaintext) };
}
export function readEncryptedArchive({ dir, storageId, key }) {
  const blob = fs.readFileSync(artifactPath(dir, storageId));
  return decryptArchive(blob, key);
}
export function deleteStoredArchive({ dir, storageId }) {
  try { fs.unlinkSync(artifactPath(dir, storageId)); return { ok: true }; }
  catch (err) { return { ok: false, error: err.code === "ENOENT" ? "NOT_FOUND" : "DELETE_FAILED" }; }
}
export function stagingDir(dir, jobId) { return path.join(dir, "staging", String(jobId).replace(/[^A-Za-z0-9_-]/g, "_")); }
export function writeChunkFile({ dir, jobId, sequence, bytes }) {
  const d = stagingDir(dir, jobId);
  ensureDir(d);
  fs.writeFileSync(path.join(d, `${sequence}.chunk`), bytes, { mode: 0o600 });
}
export function readStagedArchive({ dir, jobId, totalChunks }) {
  const d = stagingDir(dir, jobId);
  const parts = [];
  for (let i = 0; i < totalChunks; i += 1) {
    const file = path.join(d, `${i}.chunk`);
    if (!fs.existsSync(file)) return { ok: false, error: "MISSING_CHUNKS" };
    parts.push(fs.readFileSync(file));
  }
  return { ok: true, plaintext: Buffer.concat(parts) };
}
export function cleanupStaging({ dir, jobId }) {
  try { fs.rmSync(stagingDir(dir, jobId), { recursive: true, force: true }); } catch { /* best effort; staging holds no plaintext secrets beyond the archive itself */ }
}
