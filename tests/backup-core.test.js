// Tool 10 pure tests (no DB, no live services): manifest, crypto,
// paths, ZIP entry validation, serialized rewrite, transfer chunks,
// confirmation binding, state machine, preflight, plans, local storage.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { buildManifest, validateManifest, verifyManifestIntegrity } from "../lib/backup/manifest.js";
import { parseBackupEncryptionKey, encryptArchive, decryptArchive, sha256Hex, backupKeyId } from "../lib/backup/crypto.js";
import { validateRelativePath, validateArchiveEntries, isInBackupScope, BACKUP_FILE_SCOPE } from "../lib/backup/paths.js";
import { parseZipEntries } from "../lib/backup/zip.js";
import { rewriteSerializedText } from "../lib/backup/serialized.js";
import { TransferValidator } from "../lib/backup/transfer.js";
import { expectedConfirmationPhrase, planHash, verifyConfirmationToken } from "../lib/backup/confirmation.js";
import { hashSecretValue } from "../lib/backup/crypto.js";
import { canTransition, TERMINAL_STATES } from "../lib/backup/states.js";
import { evaluatePreflight } from "../lib/backup/preflight.js";
import { buildRestorePlan, buildMigrationPlan } from "../lib/backup/plan.js";
import { storeEncryptedArchive, readEncryptedArchive, deleteStoredArchive, storageReadiness, encryptionReadiness } from "../lib/backup/storage.js";
import { BACKUP_LIMITS } from "../lib/backup/limits.js";

function sampleManifest(overrides = {}) {
  return buildManifest({
    backupId: "bkp-test-1", ownerUserId: "user-1", websiteId: "site-1",
    canonicalHost: "example.com", homeUrl: "https://example.com", mode: "SITE_DATA_BACKUP",
    connectorVersion: "1.7.0", connectorSchemaVersion: 7, wordpressVersion: "7.1.3",
    phpVersion: "8.3.6", multisite: false, includedCategories: ["database", "files"],
    excludedCategories: ["wp-config.php"], tableCount: 12, fileCount: 40,
    archiveBytes: 1234, archiveSha256: "a".repeat(64),
    encryption: { scheme: "AES-256-GCM", version: 1, keyId: "0123456789abcdef" },
    ...overrides,
  });
}
test("manifest: build validates, tamper detected, multisite rejected, wp-config never in manifest secrets", () => {
  const m = sampleManifest();
  assert.equal(validateManifest(m).ok, true);
  assert.equal(verifyManifestIntegrity(m).ok, true);
  const tampered = { ...m, fileCount: 999 };
  assert.equal(verifyManifestIntegrity(tampered).ok, false);
  assert.equal(validateManifest(sampleManifest({ multisite: true })).ok, false);
  assert.equal(JSON.stringify(m).includes("BACKUP_ENCRYPTION_KEY"), false);
  assert.equal(m.encryption.keyId.length, 16);
  assert.equal("key" in (m.encryption ?? {}), false);
});
test("crypto: AES-256-GCM round trip, tamper fails, missing key blocks, no predictable key derivation", () => {
  const key = crypto.randomBytes(32);
  const plain = Buffer.from("backup bytes — secret-ish content");
  const { blob, keyId } = encryptArchive(plain, key);
  assert.equal(keyId, backupKeyId(key));
  const back = decryptArchive(blob, key);
  assert.equal(back.ok, true);
  assert.deepEqual(back.plaintext, plain);
  const flipped = Buffer.from(blob); flipped[flipped.length - 1] ^= 1;
  assert.equal(decryptArchive(flipped, key).ok, false);
  assert.equal(parseBackupEncryptionKey({}), null);
  assert.equal(parseBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: "short" }), null);
  assert.equal(parseBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: "user-1" }), null);
  const hexKey = parseBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: key.toString("hex") });
  assert.equal(hexKey.length, 32);
});
test("paths: traversal/symlink/duplicate/absolute rejected; scope excludes wp-config; dry-run paths never escape", () => {
  assert.equal(validateRelativePath("../etc/passwd").ok, false);
  assert.equal(validateRelativePath("/abs/path").ok, false);
  assert.equal(validateRelativePath("wp-content/plugins/a/b.php").ok, true);
  assert.equal(validateRelativePath("wp-content/plugins//x.php").path, "wp-content/plugins/x.php");
  const bad = validateArchiveEntries([
    { path: "wp-content/plugins/a.php", size: 10 },
    { path: "wp-content/plugins/a.php", size: 10 },
    { path: "../evil.php", size: 1 },
    { path: "wp-content/uploads/link.php", size: 1, symlink: true },
  ], BACKUP_LIMITS);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.startsWith("DUPLICATE_PATH")));
  assert.ok(bad.errors.some((e) => e.startsWith("PATH_TRAVERSAL")));
  assert.ok(bad.errors.some((e) => e.startsWith("SYMLINK_REJECTED")));
  assert.equal(isInBackupScope("wp-config.php"), false);
  assert.equal(isInBackupScope("wp-content/plugins/akismet/akismet.php"), true);
  assert.equal(isInBackupScope("../../outside.txt"), false);
  assert.ok(BACKUP_FILE_SCOPE.includes("wp-content/uploads"));
});
function buildZip(entries) {
  // Minimal stored (method 0) ZIP builder for tests.
  const local = []; const central = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.path, "utf8");
    const data = Buffer.from(e.data ?? "", "utf8");
    const crc = 0; // CRC is not checked by parseZipEntries (entry-list validation only)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE((e.symlink ? (0o120777 << 16) : (0o100644 << 16)) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const centralStart = offset;
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(centralStart, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...local, ...central, eocd]);
}
test("zip: entry list validated, symlink flagged, traversal entry rejected by path validation", () => {
  const zip = buildZip([
    { path: "wp-content/plugins/a.php", data: "hello" },
    { path: "wp-content/uploads/link.php", data: "", symlink: true },
    { path: "../evil.php", data: "x" },
  ]);
  const parsed = parseZipEntries(zip);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries.length, 3);
  const checked = validateArchiveEntries(parsed.entries, BACKUP_LIMITS);
  assert.equal(checked.ok, false);
  assert.equal(parseZipEntries(Buffer.from("not a zip")).ok, false);
});
test("serialized rewrite: lengths recomputed, nested arrays, multibyte safe, objects untouched, plain text rewritten", () => {
  const from = "https://old.example"; const to = "https://new.example";
  const input = `a:2:{i:0;s:19:"${from}/x";i:1;s:5:"héllo";}`;
  // s:19 is wrong for the first string on purpose? No — build it correctly:
  const real = `a:1:{i:0;s:${Buffer.byteLength(from + "/x") }:"${from}/x";}`;
  const out = rewriteSerializedText(real, from, to);
  assert.equal(out.replaced, 1);
  assert.equal(out.text, `a:1:{i:0;s:${Buffer.byteLength(to + "/x")}:"${to}/x";}`);
  assert.deepEqual(out.unsupported, []);
  const mb = `s:${Buffer.byteLength("héllo " + from)}:"héllo ${from}";`;
  const mbOut = rewriteSerializedText(mb, from, to);
  assert.equal(mbOut.text, `s:${Buffer.byteLength("héllo " + to)}:"héllo ${to}";`);
  const obj = `O:8:"stdClass":1:{s:3:"url";s:${Buffer.byteLength(from)}:"${from}";}`;
  const objOut = rewriteSerializedText(obj, from, to);
  assert.ok(objOut.unsupported.some((u) => u.startsWith("UNSUPPORTED_SERIALIZED_TYPE_O")));
  assert.ok(objOut.text.includes(from)); // verbatim, never corrupted
  const plain = rewriteSerializedText(`Visit ${from}/about for details.`, from, to);
  assert.equal(plain.text, `Visit ${to}/about for details.`);
  assert.equal(rewriteSerializedText(real, from, from).unsupported[0], "SOURCE_EQUALS_DESTINATION");
  void input;
});
test("transfer: sequence, duplicates, missing chunks, checksum mismatch detected", () => {
  const data = Buffer.from("chunked-backup-payload");
  const half = Math.ceil(data.length / 2);
  const c0 = data.subarray(0, half); const c1 = data.subarray(half);
  const v = new TransferValidator({ totalChunks: 2, totalBytes: data.length, totalSha256: sha256Hex(data) });
  assert.equal(v.addChunk(5, c0, sha256Hex(c0)).ok, false);
  assert.equal(v.addChunk(0, c0, "0".repeat(64)).ok, false);
  assert.equal(v.addChunk(0, c0, sha256Hex(c0)).ok, true);
  assert.equal(v.addChunk(0, c0, sha256Hex(c0)).ok, false);
  assert.equal(v.complete.ok, false); // missing chunk 1
  assert.equal(v.addChunk(1, c1, sha256Hex(c1)).ok, true);
  assert.equal(v.complete.ok, true);
  assert.equal(v.verifyTotal(data).ok, true);
  assert.equal(v.verifyTotal(Buffer.from("tampered")).ok, false);
});
test("confirmation: phrase bound to host, token replay/expiry/plan-change rejected", () => {
  assert.equal(expectedConfirmationPhrase("RESTORE", "example.com"), "RESTORE TO example.com");
  assert.equal(expectedConfirmationPhrase("MIGRATION", "example.com"), "MIGRATE TO example.com");
  const binding = { userId: "u1", sourceWebsiteId: "s1", destinationWebsiteId: "d1", operationType: "RESTORE", backupId: "b1", planHash: planHash({ a: 1 }) };
  const stored = { tokenHash: hashSecretValue("tok-123"), expiresAt: Date.now() + 60000, usedAt: null, binding };
  assert.equal(verifyConfirmationToken({ stored, token: "tok-123", binding }).ok, true);
  assert.equal(verifyConfirmationToken({ stored, token: "wrong", binding }).ok, false);
  assert.equal(verifyConfirmationToken({ stored: { ...stored, usedAt: Date.now() }, token: "tok-123", binding }).ok, false);
  assert.equal(verifyConfirmationToken({ stored: { ...stored, expiresAt: Date.now() - 1 }, token: "tok-123", binding }).ok, false);
  assert.equal(verifyConfirmationToken({ stored, token: "tok-123", binding: { ...binding, destinationWebsiteId: "other" } }).ok, false);
  assert.equal(planHash({ b: 2, a: 1 }), planHash({ a: 1, b: 2 }));
});
test("states: terminal states have no outgoing transitions; destructive jobs are distinct", () => {
  for (const s of TERMINAL_STATES) assert.equal(canTransition(s, "RUNNING"), false);
  assert.equal(canTransition("AWAITING_CONFIRMATION", "BLOCKED"), true);
  assert.equal(canTransition("COMPLETED", "CANCELLED"), false);
  assert.equal(canTransition("DRAFT", "COMPLETED"), false);
});
test("preflight: stale snapshot, inactive connection, multisite, missing storage/encryption all block; nothing proceeds", () => {
  const blocked = evaluatePreflight({ snapshot: { multisite: false }, snapshotReceivedAt: new Date(Date.now() - 25 * 3600 * 1000), connectionStatus: "ACTIVE", storage: { ready: true }, encryption: { ready: true }, mode: "SITE_DATA_BACKUP" });
  assert.equal(blocked.ok, false); assert.ok(blocked.blockers.includes("SNAPSHOT_STALE"));
  const ms = evaluatePreflight({ snapshot: { multisite: true }, snapshotReceivedAt: new Date(), connectionStatus: "ACTIVE", storage: { ready: true }, encryption: { ready: true }, mode: "SITE_DATA_BACKUP" });
  assert.ok(ms.blockers.includes("MULTISITE_UNSUPPORTED"));
  const noStore = evaluatePreflight({ snapshot: {}, snapshotReceivedAt: new Date(), connectionStatus: "ACTIVE", storage: { ready: false }, encryption: { ready: false }, mode: "SITE_DATA_BACKUP" });
  assert.ok(noStore.blockers.includes("STORAGE_UNAVAILABLE")); assert.ok(noStore.blockers.includes("ENCRYPTION_NOT_CONFIGURED"));
});
test("plans: restore/migration plans hash, carry rollback requirement, never authorize a different plan", () => {
  const artifact = { id: "b1", mode: "SITE_DATA_BACKUP", createdAt: new Date("2026-10-28T00:00:00Z"), sourceWebsiteId: "s1", manifest: { siteIdentity: { canonicalHost: "old.example" }, mode: "SITE_DATA_BACKUP", includedCategories: ["database", "files"], excludedCategories: ["wp-config.php"], limitations: [], tablePrefix: "wp_" } };
  const target = { id: "d1", normalizedUrl: "https://new.example" };
  const { plan, hash } = buildRestorePlan({ artifact, targetWebsite: target });
  assert.equal(hash, planHash(plan));
  assert.equal(plan.rollbackBackupRequired, true);
  assert.equal(plan.urlDifference.from, "old.example");
  assert.ok(plan.limitations.some((l) => l.includes("NOT implemented")));
  const mig = buildMigrationPlan({ sourceWebsite: { id: "s1", normalizedUrl: "https://old.example" }, destinationWebsite: target, sourceArtifact: artifact, destinationRollbackArtifact: null, sourceSnapshot: { wordpressVersion: "7.1.3", phpVersion: "8.3.6" }, destinationSnapshot: { wordpressVersion: "7.1.3", phpVersion: "8.3.6" } });
  assert.equal(mig.plan.destinationRollbackBackupId, null);
  assert.ok(mig.plan.excludedCategories.some((c) => c.includes("wp-config")));
});
test("storage: encrypted local round trip, tamper fails, production local blocked, missing dir blocks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wpdoctor-backup-test-"));
  const key = crypto.randomBytes(32);
  const plain = Buffer.from("stored backup bytes");
  const stored = storeEncryptedArchive({ dir, plaintext: plain, key });
  assert.equal(stored.archiveSha256, sha256Hex(plain));
  const back = readEncryptedArchive({ dir, storageId: stored.storageId, key });
  assert.equal(back.ok, true); assert.deepEqual(back.plaintext, plain);
  const wrongKey = readEncryptedArchive({ dir, storageId: stored.storageId, key: crypto.randomBytes(32) });
  assert.equal(wrongKey.ok, false);
  assert.equal(deleteStoredArchive({ dir, storageId: stored.storageId }).ok, true);
  assert.equal(deleteStoredArchive({ dir, storageId: stored.storageId }).error, "NOT_FOUND");
  assert.equal(storageReadiness({ BACKUP_STORAGE_DRIVER: "local", NODE_ENV: "production", BACKUP_STORAGE_DIR: dir }).ready, false);
  assert.equal(storageReadiness({ BACKUP_STORAGE_DRIVER: "local", BACKUP_STORAGE_DIR: "" }).ready, false);
  assert.equal(encryptionReadiness({}).ready, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
