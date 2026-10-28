// Tool 10 authenticated encryption (vetted Node built-in crypto only).
// AES-256-GCM, random 12-byte nonce per archive, key identifier is a
// truncated SHA-256 of the key (never the key itself). There is NO
// plaintext fallback: a missing/unparsable key returns null and the
// caller must BLOCK the operation. The SaaS holds the key, so this is
// encryption at rest by the service — never "end-to-end encryption".
import crypto from "node:crypto";
export function parseBackupEncryptionKey(env = process.env) {
  const raw = (env.BACKUP_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try { const decoded = Buffer.from(raw, "base64"); if (decoded.length === 32) key = decoded; } catch { key = null; }
  }
  return key && key.length === 32 ? key : null;
}
export function backupKeyId(key) {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}
// File format: ASCII magic + 12-byte nonce + 16-byte GCM tag + ciphertext.
const MAGIC = Buffer.from("WPDBKP1\n", "ascii");
export function encryptArchive(plaintext, key) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { keyId: backupKeyId(key), blob: Buffer.concat([MAGIC, nonce, tag, ciphertext]) };
}
export function decryptArchive(blob, key) {
  if (!Buffer.isBuffer(blob) || blob.length < MAGIC.length + 28) return { ok: false, error: "DECRYPTION_FAILED" };
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) return { ok: false, error: "UNSUPPORTED_ARCHIVE_FORMAT" };
  const nonce = blob.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = blob.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ciphertext = blob.subarray(MAGIC.length + 28);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { ok: true, plaintext };
  } catch {
    return { ok: false, error: "DECRYPTION_FAILED" };
  }
}
export function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
export function hashSecretValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}
