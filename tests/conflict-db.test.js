// Milestone 6 DB tests (run via scripts/run-db-tests.mjs with TEST_DATABASE_URL).
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { createConflictDiagnostic, ConflictError } from "../lib/conflict/service.js";
import { generateConflictAiAnalysis } from "../lib/conflict/ai.js";
import { MockProvider } from "../lib/ai/providers.js";
import { buildConflictAiMessages } from "../lib/conflict/ai-prompt.js";
import { ConflictRateLimiter } from "../lib/conflict/rate-limit.js";
import { AiRateLimiter } from "../lib/ai/rate-limit.js";

const RUN = `cf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA, userB, website, connection;

const v2Payload = {
  schemaVersion: 2,
  wordpressVersion: "6.8",
  phpVersion: "8.3",
  homeUrl: "https://example.com",
  siteUrl: "https://example.com",
  pluginVersion: "1.1.0",
  activePlugins: [{ name: "Sample", version: "1.0" }],
  activeTheme: { name: "Theme", version: "1.0" },
  multisite: false,
  locale: "en_US",
  plugins: [{
    name: "Sample", slug: "sample", version: "1.0", active: true,
    networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: "8.4",
    dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: 1700000000,
  }],
  theme: { name: "Theme", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null },
};

async function makeUser(suffix) {
  return prisma.user.create({ data: { name: "Conflict Tester", email: `${RUN}-${suffix}@example.invalid` } });
}
async function makeWebsite(userId, url) {
  return prisma.website.create({ data: { name: "Test Site", normalizedUrl: url, userId } });
}
async function seedSnapshot(conn, payload, receivedAt = new Date()) {
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: conn.id } });
  return prisma.connectorDiagnosticSnapshot.create({
    data: { connectionId: conn.id, websiteId: conn.websiteId, schemaVersion: payload.schemaVersion, payload, receivedAt },
  });
}

test("conflict db: users, website, connection", async () => {
  userA = await makeUser("a");
  userB = await makeUser("b");
  website = await makeWebsite(userA.id, `https://${RUN}.example.com`);
  connection = await prisma.websiteConnection.create({
    data: { websiteId: website.id, status: "ACTIVE", credentialHash: "test-hash" },
  });
  await prisma.website.update({ where: { id: website.id }, data: { connectionStatus: "CONNECTED" } });
  assert.ok(connection.id);
});

test("conflict db: diagnostic persists with findings and snapshot copy", async () => {
  await seedSnapshot(connection, v2Payload);
  const diag = await createConflictDiagnostic(userA.id, {
    websiteId: website.id,
    symptomCategory: "ADMIN_ERROR",
    symptomDescription: "Admin blank after update.",
    errorExcerpt: "Fatal error, password=hunter2 should be redacted",
  }, { limiter: new ConflictRateLimiter() });
  assert.equal(diag.status, "COMPLETED");
  assert.ok(diag.findings.some((f) => f.ruleId === "A"));
  assert.match(diag.errorExcerpt, /password=\[redacted\]/);
  assert.doesNotMatch(diag.errorExcerpt, /hunter2/);
  // Snapshot-copy integrity: replace the live snapshot, diagnostic copy unchanged.
  const other = { ...v2Payload, phpVersion: "8.1" };
  await seedSnapshot(connection, other);
  const stored = await prisma.conflictDiagnostic.findUnique({ where: { id: diag.id } });
  assert.equal(stored.snapshotPayload.phpVersion, "8.3");
  assert.equal(stored.snapshotSchemaVersion, 2);
  globalThis.__diagId = diag.id;
});

test("conflict db: ownership-scoped retrieval; another user's website is 404-identical", async () => {
  await assert.rejects(
    () => createConflictDiagnostic(userB.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "x" }, { limiter: new ConflictRateLimiter() }),
    (e) => e instanceof ConflictError && e.status === 404,
  );
  const rows = await prisma.conflictDiagnostic.findMany({ where: { userId: userB.id } });
  assert.equal(rows.length, 0);
});

test("conflict db: stale snapshot blocks with no row persisted", async () => {
  await seedSnapshot(connection, v2Payload, new Date(Date.now() - 25 * 60 * 60 * 1000));
  const before = await prisma.conflictDiagnostic.count({ where: { userId: userA.id } });
  await assert.rejects(
    () => createConflictDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "stale test" }, { limiter: new ConflictRateLimiter() }),
    (e) => e instanceof ConflictError && e.code === "SNAPSHOT_STALE" && e.status === 422,
  );
  const after = await prisma.conflictDiagnostic.count({ where: { userId: userA.id } });
  assert.equal(after, before);
});

test("conflict db: unsupported schema blocks; invalid payload blocks", async () => {
  await seedSnapshot(connection, { ...v2Payload, schemaVersion: 99 });
  await assert.rejects(
    () => createConflictDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "unsupported" }, { limiter: new ConflictRateLimiter() }),
    (e) => e instanceof ConflictError && e.code === "SNAPSHOT_UNSUPPORTED",
  );
  await seedSnapshot(connection, { schemaVersion: 2, wordpressVersion: "6.8", evil: true });
  await assert.rejects(
    () => createConflictDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "invalid" }, { limiter: new ConflictRateLimiter() }),
    (e) => e instanceof ConflictError && e.code === "SNAPSHOT_INVALID",
  );
});

test("conflict db: missing snapshot blocks; revoked connection blocks", async () => {
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: connection.id } });
  await assert.rejects(
    () => createConflictDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "missing" }, { limiter: new ConflictRateLimiter() }),
    (e) => e instanceof ConflictError && e.code === "SNAPSHOT_MISSING",
  );
  await seedSnapshot(connection, v2Payload);
  await prisma.websiteConnection.update({ where: { id: connection.id }, data: { status: "REVOKED" } });
  await assert.rejects(
    () => createConflictDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "revoked" }, { limiter: new ConflictRateLimiter() }),
    (e) => e instanceof ConflictError && e.code === "SNAPSHOT_MISSING",
  );
  await prisma.websiteConnection.update({ where: { id: connection.id }, data: { status: "ACTIVE" } });
});

test("conflict db: validation errors and rate limit", async () => {
  await seedSnapshot(connection, v2Payload);
  await assert.rejects(
    () => createConflictDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "NOPE", symptomDescription: "x" }, { limiter: new ConflictRateLimiter() }),
    (e) => e instanceof ConflictError && e.status === 400,
  );
  await assert.rejects(
    () => createConflictDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "x".repeat(2001) }, { limiter: new ConflictRateLimiter() }),
    (e) => e instanceof ConflictError && e.status === 400,
  );
  const tight = new ConflictRateLimiter({ limitPerHour: 1 });
  await createConflictDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "first" }, { limiter: tight });
  await assert.rejects(
    () => createConflictDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "second" }, { limiter: tight }),
    (e) => e instanceof ConflictError && e.status === 429,
  );
});

test("conflict db: AI analysis stored separately; deterministic findings untouched", async () => {
  const diag = await prisma.conflictDiagnostic.findUnique({
    where: { id: globalThis.__diagId },
    include: { findings: true },
  });
  const findingsBefore = JSON.stringify(diag.findings);
  const analysis = {
    schemaVersion: "conflict-1",
    summary: "One mismatch found.",
    explanation: "The PHP mismatch is worth testing on staging.",
    diagnosticConfidence: "MEDIUM",
    confirmedObservations: [{ findingId: diag.findings[0].id, observation: "PHP mismatch observed." }],
    causeHypotheses: [{
      title: "PHP mismatch may relate to the symptom",
      explanation: "Test on staging.",
      confidence: "LOW",
      supportingFindingIds: [diag.findings[0].id],
      additionalEvidenceRequired: "Staging reproduction.",
    }],
    recommendedActions: [{
      title: "Test on staging",
      explanation: "Back up first.",
      priority: "MEDIUM",
      riskLevel: "LOW",
      skillLevel: "Intermediate",
      steps: ["Back up.", "Reproduce on staging."],
      referencedFindingIds: [diag.findings[0].id],
      humanReviewRecommended: true,
    }],
    missingEvidence: ["Logs not collected."],
    limitations: ["Deterministic only."],
    humanReviewRecommended: true,
  };
  const provider = new MockProvider({ behavior: "success", analysis, messagesBuilder: buildConflictAiMessages });
  const result = await generateConflictAiAnalysis({
    diagnostic: diag,
    findings: diag.findings,
    userId: userA.id,
    providerOverride: provider,
    limiter: new AiRateLimiter({ limitPerDay: 10 }),
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.schemaVersion, "conflict-1");
  const after = await prisma.conflictDiagnostic.findUnique({
    where: { id: diag.id },
    include: { findings: true },
  });
  assert.equal(JSON.stringify(after.findings), findingsBefore, "AI must not modify deterministic findings");
  const again = await generateConflictAiAnalysis({
    diagnostic: diag,
    findings: diag.findings,
    userId: userA.id,
    providerOverride: provider,
    limiter: new AiRateLimiter({ limitPerDay: 10 }),
  });
  assert.equal(again.fromCache, true);
});

test("conflict db: AI validation failure persists FAILED row and is retryable", async () => {
  await seedSnapshot(connection, v2Payload);
  const diag = await createConflictDiagnostic(userA.id, {
    websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "ai fail test",
  }, { limiter: new ConflictRateLimiter() });
  const full = await prisma.conflictDiagnostic.findUnique({ where: { id: diag.id }, include: { findings: true } });
  const bad = {
    schemaVersion: "conflict-1", summary: "x", explanation: "x", diagnosticConfidence: "MEDIUM",
    confirmedObservations: [{ findingId: "unknown-id", observation: "x" }],
    causeHypotheses: [], recommendedActions: [], missingEvidence: [], limitations: [], humanReviewRecommended: true,
  };
  const provider = new MockProvider({ behavior: "success", analysis: bad, messagesBuilder: buildConflictAiMessages });
  await assert.rejects(
    () => generateConflictAiAnalysis({
      diagnostic: full, findings: full.findings, userId: userA.id,
      providerOverride: provider, limiter: new AiRateLimiter({ limitPerDay: 10 }),
    }),
    (e) => e.code === "INVALID_OUTPUT",
  );
  const failed = await prisma.conflictAiAnalysis.findUnique({ where: { diagnosticId: diag.id } });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.errorCode, "INVALID_OUTPUT");
  assert.equal(failed.analysis, null);
});

test("conflict db: cleanup (cascade)", async () => {
  await prisma.user.delete({ where: { id: userA.id } });
  await prisma.user.delete({ where: { id: userB.id } });
  const left = await prisma.conflictDiagnostic.count({ where: { websiteId: website.id } });
  assert.equal(left, 0, "deleting the user cascades diagnostics");
});
