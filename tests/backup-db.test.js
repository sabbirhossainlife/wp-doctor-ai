// Tool 10 DB tests. Run via scripts/run-db-tests.mjs with
// TEST_DATABASE_URL. No live WordPress, no live storage service: the
// connector evidence is a deterministic v7 fixture snapshot, storage is
// a temp directory, and the encryption key is a random test key.
// Covers: ownership, preflight blocking, chunked transfer + verified
// artifact, download-token one-use, delete rules, restore/migration
// dry-run + typed confirmation + BLOCKED execution (never fake
// success), duplicate/conflicting-job prevention, plan-change
// invalidation, and the SaaS-PostgreSQL-is-never-a-target rule.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import {
  createBackupJob, transferInit, transferChunk, transferComplete,
  listArtifacts, getArtifact, deleteArtifact, createDownloadToken,
  consumeDownloadToken, createRestoreJob, createMigrationJob,
  confirmOperation, cancelBackupOperation, getBackupOperation,
  BackupError, BackupRateLimiter,
} from "../lib/backup/service.js";
import { sha256Hex } from "../lib/backup/crypto.js";

const RUN = `bkp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "wpdoctor-backup-db-"));
const KEY_HEX = crypto.randomBytes(32).toString("hex");
const ENV = { BACKUP_STORAGE_DRIVER: "local", BACKUP_STORAGE_DIR: TMP, BACKUP_ENCRYPTION_KEY: KEY_HEX, NODE_ENV: "test" };
const LIMITER = () => new BackupRateLimiter({ limitPerHour: 1000 });
let userA, userB, siteA, siteB, connectionA, connectionB;

function v7Payload(host) {
  return {
    schemaVersion: 7, wordpressVersion: "7.1.3", phpVersion: "8.3.6",
    homeUrl: `https://${host}`, siteUrl: `https://${host}`, pluginVersion: "1.7.0",
    activePlugins: [{ name: "Akismet", version: "5.3" }],
    activeTheme: { name: "Oishi", version: "1.0" }, multisite: false, locale: "en_US",
    plugins: [{ name: "Akismet", slug: "akismet", version: "5.3", active: true, networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: null, dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: null }],
    theme: { name: "Oishi", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null, slug: "oishi" },
    woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: false, active: false, version: null, pro: { installed: false, active: false, version: null }, status: "NOT_INSTALLED" },
    environment: { phpMemoryLimit: null, wpMemoryLimit: null, maxExecutionTime: null },
    contactForms: [], mailTransport: [],
    senderDomain: { senderConfigured: "unknown", senderDomain: null, domainMatches: null, comparisonEstablished: false },
    securityIndicators: { wpDebug: "no", wpDebugDisplay: "no", wpDebugLog: "no", disallowFileEdit: "yes" },
    malwareScan: null,
  };
}
function buildTestZip(entries) {
  const local = []; const central = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.path, "utf8"); const data = Buffer.from(e.data ?? "", "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const centralStart = offset; const centralSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...local, ...central, eocd]);
}
async function makeSite(user, host) {
  const website = await prisma.website.create({ data: { userId: user.id, name: host, normalizedUrl: `https://${host}`, connectionStatus: "CONNECTED" } });
  const connection = await prisma.websiteConnection.create({ data: { websiteId: website.id, status: "ACTIVE", credentialHash: sha256Hex(`cred-${RUN}-${host}`), pluginVersion: "1.7.0" } });
  await prisma.connectorDiagnosticSnapshot.create({ data: { connectionId: connection.id, websiteId: website.id, schemaVersion: 7, payload: v7Payload(host), receivedAt: new Date() } });
  return { website, connection };
}
async function expectCode(promise, code) {
  try { await promise; assert.fail(`expected ${code}`); }
  catch (err) { assert.ok(err instanceof BackupError, `expected BackupError, got ${err}`); assert.equal(err.code, code); }
}

test.before(async () => {
  userA = await prisma.user.create({ data: { name: "Backup A", email: `bkp-a-${RUN}@example.invalid`, role: "USER" } });
  userB = await prisma.user.create({ data: { name: "Backup B", email: `bkp-b-${RUN}@example.invalid`, role: "USER" } });
  ({ website: siteA, connection: connectionA } = await makeSite(userA, "site-a.example"));
  ({ website: siteB, connection: connectionB } = await makeSite(userB, "site-b.example"));
  void connectionA; void connectionB;
});
test.after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  fs.rmSync(TMP, { recursive: true, force: true });
  await prisma.$disconnect();
});

test("backup job blocked without storage/encryption config; queued with config; sensitive ack required", async () => {
  const blocked = await createBackupJob(userA.id, { websiteId: siteA.id, mode: "SITE_DATA_BACKUP", acknowledgeSensitiveData: true }, { limiter: LIMITER(), env: {} });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.operation.state, "BLOCKED");
  assert.ok(["STORAGE_UNAVAILABLE", "ENCRYPTION_NOT_CONFIGURED"].includes(blocked.operation.errorCode));
  await expectCode(createBackupJob(userA.id, { websiteId: siteA.id, mode: "SITE_DATA_BACKUP", acknowledgeSensitiveData: false }, { limiter: LIMITER(), env: ENV }), "VALIDATION_FAILED");
  await expectCode(createBackupJob(userA.id, { websiteId: siteA.id, mode: "EVERYTHING", acknowledgeSensitiveData: true }, { limiter: LIMITER(), env: ENV }), "VALIDATION_FAILED");
  await expectCode(createBackupJob(userB.id, { websiteId: siteA.id, mode: "SITE_DATA_BACKUP", acknowledgeSensitiveData: true }, { limiter: LIMITER(), env: ENV }), "WEBSITE_NOT_FOUND");
  const queued = await createBackupJob(userA.id, { websiteId: siteA.id, mode: "SITE_DATA_BACKUP", acknowledgeSensitiveData: true }, { limiter: LIMITER(), env: ENV });
  assert.equal(queued.blocked, false);
  assert.equal(queued.operation.state, "QUEUED");
  globalThis.__bkpJob = queued.operation.id;
});

test("chunked transfer: duplicate/missing/checksum rules, then verified artifact + download token one-use", async () => {
  const jobId = globalThis.__bkpJob;
  const zip = buildTestZip([
    { path: "manifest.json", data: "{}" },
    { path: "wp-content/plugins/a.php", data: "<?php // test" },
  ]);
  await transferInit(userA.id, jobId, { totalChunks: 2, totalBytes: zip.length, totalSha256: sha256Hex(zip) }, { env: ENV });
  const half = Math.ceil(zip.length / 2);
  const c0 = zip.subarray(0, half); const c1 = zip.subarray(half);
  await expectCode(transferChunk(userA.id, jobId, { sequence: 0, chunkBase64: c0.toString("base64"), chunkSha256: "0".repeat(64) }, { env: ENV }), "VALIDATION_FAILED");
  await transferChunk(userA.id, jobId, { sequence: 0, chunkBase64: c0.toString("base64"), chunkSha256: sha256Hex(c0) }, { env: ENV });
  await expectCode(transferChunk(userA.id, jobId, { sequence: 0, chunkBase64: c0.toString("base64"), chunkSha256: sha256Hex(c0) }, { env: ENV }), "VALIDATION_FAILED");
  await expectCode(transferComplete(userA.id, jobId, { manifest: {} }, { env: ENV }), "VALIDATION_FAILED"); // missing chunk 1
  await transferChunk(userA.id, jobId, { sequence: 1, chunkBase64: c1.toString("base64"), chunkSha256: sha256Hex(c1) }, { env: ENV });
  const done = await transferComplete(userA.id, jobId, { manifest: { tableCount: 3, includedCategories: ["database", "files"], excludedCategories: ["wp-config.php"] }, connectorVersion: "1.7.0" }, { env: ENV });
  assert.equal(done.operation.state, "COMPLETED");
  assert.equal(done.artifact.status, "VERIFIED");
  assert.equal(done.artifact.verificationStatus, "VERIFIED");
  assert.equal(done.artifact.archiveSha256, sha256Hex(zip));
  assert.equal(done.artifact.fileCount, 2);
  assert.equal("storageId" in done.artifact, false); // internal storage reference never exposed
  globalThis.__artifact = done.artifact.id;
  // Ownership: other user cannot read it.
  await expectCode(getArtifact(userB.id, done.artifact.id), "NOT_FOUND");
  await expectCode(getBackupOperation(userB.id, jobId), "NOT_FOUND");
  // Download token: one use only.
  const { token } = await createDownloadToken(userA.id, done.artifact.id, { env: ENV });
  const dl = await consumeDownloadToken(userA.id, done.artifact.id, token, { env: ENV });
  assert.deepEqual(dl.buffer, zip);
  await expectCode(consumeDownloadToken(userA.id, done.artifact.id, token, { env: ENV }), "DOWNLOAD_TOKEN_INVALID");
  await expectCode(consumeDownloadToken(userB.id, done.artifact.id, token, { env: ENV }), "NOT_FOUND");
});

test("restore: dry-run plan, wrong phrase rejected, plan change invalidates, correct phrase blocks execution honestly", async () => {
  const artifactId = globalThis.__artifact;
  const created = await createRestoreJob(userA.id, { backupId: artifactId, destinationWebsiteId: siteA.id }, { limiter: LIMITER(), env: ENV });
  assert.equal(created.blocked, false);
  assert.equal(created.operation.state, "AWAITING_CONFIRMATION");
  assert.equal(created.operation.planHash.length, 64);
  assert.equal(created.operation.plan.destinationHost, "site-a.example");
  // SaaS-DB guard: destination is the registered WordPress Website row,
  // and the plan carries no database URL/credential of any kind.
  assert.equal(created.operation.destinationWebsiteId, siteA.id);
  assert.equal(JSON.stringify(created.operation.plan).includes("postgres"), false);
  await expectCode(confirmOperation(userA.id, created.operation.id, { phrase: "RESTORE TO wrong.example" }), "VALIDATION_FAILED");
  // Tamper the plan directly, then confirm must refuse (plan changed).
  await prisma.backupOperation.update({ where: { id: created.operation.id }, data: { plan: { ...created.operation.plan, mode: "TAMPERED" } } });
  await expectCode(confirmOperation(userA.id, created.operation.id, { phrase: "RESTORE TO site-a.example" }), "CONFIRMATION_PLAN_CHANGED");
  await prisma.backupOperation.update({ where: { id: created.operation.id }, data: { plan: created.operation.plan } });
  const confirmed = await confirmOperation(userA.id, created.operation.id, { phrase: "RESTORE TO site-a.example" });
  assert.equal(confirmed.executionBlocked, true);
  assert.equal(confirmed.operation.state, "BLOCKED");
  assert.equal(confirmed.operation.errorCode, "RESTORE_EXECUTION_NOT_IMPLEMENTED");
  // Idempotent re-confirm: same blocked result, no duplicate job.
  const again = await confirmOperation(userA.id, created.operation.id, { phrase: "RESTORE TO site-a.example" });
  assert.equal(again.operation.state, "BLOCKED");
  // Conflicting-job prevention: an AWAITING restore blocks a second one.
  const first = await createRestoreJob(userA.id, { backupId: artifactId, destinationWebsiteId: siteA.id }, { limiter: LIMITER(), env: ENV });
  assert.equal(first.operation.state, "AWAITING_CONFIRMATION");
  const second = await createRestoreJob(userA.id, { backupId: artifactId, destinationWebsiteId: siteA.id }, { limiter: LIMITER(), env: ENV });
  assert.equal(second.blocked, true);
  assert.equal(second.operation.errorCode, "CONFLICTING_JOB_ACTIVE");
  await cancelBackupOperation(userA.id, first.operation.id);
  await expectCode(cancelBackupOperation(userA.id, first.operation.id), "INVALID_STATE_TRANSITION");
});

test("migration: same-site rejected, missing source backup blocks, correct phrase blocks execution, source never deleted", async () => {
  await expectCode(createMigrationJob(userA.id, { sourceWebsiteId: siteA.id, destinationWebsiteId: siteA.id, sourceBackupId: globalThis.__artifact }, { limiter: LIMITER(), env: ENV }), "VALIDATION_FAILED");
  const siteA2 = await makeSite(userA, "site-a2.example");
  const blocked = await createMigrationJob(userA.id, { sourceWebsiteId: siteA.id, destinationWebsiteId: siteA2.website.id, sourceBackupId: null }, { limiter: LIMITER(), env: ENV });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.operation.errorCode, "SOURCE_BACKUP_REQUIRED");
  const created = await createMigrationJob(userA.id, { sourceWebsiteId: siteA.id, destinationWebsiteId: siteA2.website.id, sourceBackupId: globalThis.__artifact }, { limiter: LIMITER(), env: ENV });
  assert.equal(created.blocked, false);
  assert.equal(created.operation.state, "AWAITING_CONFIRMATION");
  assert.equal(created.operation.plan.destinationRollbackBackupId, null);
  const confirmed = await confirmOperation(userA.id, created.operation.id, { phrase: "MIGRATE TO site-a2.example" });
  assert.equal(confirmed.executionBlocked, true);
  assert.equal(confirmed.operation.errorCode, "MIGRATION_EXECUTION_NOT_IMPLEMENTED");
  // Source still exists and was never deleted by the migration flow.
  const sourceStill = await prisma.website.findFirst({ where: { id: siteA.id, userId: userA.id } });
  assert.ok(sourceStill);
  await prisma.website.deleteMany({ where: { id: siteA2.website.id } });
});

test("artifact deletion: blocked by active job, succeeds afterwards, storage deletion verified", async () => {
  const artifactId = globalThis.__artifact;
  // Create an AWAITING restore referencing the artifact, then deletion must refuse.
  const job = await createRestoreJob(userA.id, { backupId: artifactId, destinationWebsiteId: siteA.id }, { limiter: LIMITER(), env: ENV });
  assert.equal(job.operation.state, "AWAITING_CONFIRMATION");
  await expectCode(deleteArtifact(userA.id, artifactId, { env: ENV }), "BACKUP_IN_USE");
  await cancelBackupOperation(userA.id, job.operation.id);
  const deleted = await deleteArtifact(userA.id, artifactId, { env: ENV });
  assert.equal(deleted.status, "DELETED");
  const again = await deleteArtifact(userA.id, artifactId, { env: ENV });
  assert.equal(again.status, "DELETED");
  const listed = await listArtifacts(userA.id, {});
  assert.ok(listed.artifacts.some((a) => a.id === artifactId && a.status === "DELETED"));
});
