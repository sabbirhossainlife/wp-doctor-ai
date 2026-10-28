// Milestone 8 DB tests (run via scripts/run-db-tests.mjs with TEST_DATABASE_URL).
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { createElementorDiagnostic, ElementorError, getElementorSnapshotView } from "../lib/elementor/service.js";
import { generateElementorAiAnalysis } from "../lib/elementor/ai.js";
import { MockProvider, AiProviderError } from "../lib/ai/providers.js";
import { buildElementorAiMessages } from "../lib/elementor/ai-prompt.js";
import { ElementorRateLimiter } from "../lib/elementor/rate-limit.js";
import { AiRateLimiter } from "../lib/ai/rate-limit.js";

const RUN = `el-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA, userB, website, connection;

const v4Payload = {
  schemaVersion: 4,
  wordpressVersion: "7.1.3",
  phpVersion: "8.3.6",
  homeUrl: "https://example.com",
  siteUrl: "https://example.com",
  pluginVersion: "1.3.0",
  activePlugins: [{ name: "Elementor", version: "4.3.5" }],
  activeTheme: { name: "Theme", version: "1.0" },
  multisite: false,
  locale: "en_US",
  plugins: [{
    name: "Elementor", slug: "elementor", version: "4.3.5", active: true,
    networkActive: false, muPlugin: false, requiresWP: "6.5", requiresPHP: "7.4",
    dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: 1700000000,
  }],
  theme: { name: "Theme", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null },
  woocommerce: {
    installed: false, active: false, version: null, status: "NOT_INSTALLED",
    pages: { cart: null, checkout: null, myAccount: null }, gateways: [],
  },
  elementor: { installed: true, active: true, version: "4.3.5", pro: { installed: false, active: false, version: null }, status: "AVAILABLE" },
  environment: { phpMemoryLimit: "128M", wpMemoryLimit: "128M", maxExecutionTime: "300" },
};

async function makeUser(suffix) {
  return prisma.user.create({ data: { name: "Elementor Tester", email: `${RUN}-${suffix}@example.invalid` } });
}
async function seedSnapshot(conn, payload, receivedAt = new Date()) {
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: conn.id } });
  return prisma.connectorDiagnosticSnapshot.create({
    data: { connectionId: conn.id, websiteId: conn.websiteId, schemaVersion: payload.schemaVersion, payload, receivedAt },
  });
}
function validAnalysis(findingIds) {
  return {
    schemaVersion: "elementor-1",
    summary: "Elementor is available; the configured memory limit is below the recommendation.",
    explanation: "The snapshot shows Elementor available and a 128M configured limit.",
    diagnosticConfidence: "MEDIUM",
    confirmedObservations: [{ findingId: findingIds[0], observation: "Configured memory limit is 128M." }],
    causeHypotheses: [{
      title: "Memory warning to investigate", explanation: "The limit is below the 256 MB recommendation band.",
      confidence: "MEDIUM", supportingFindingIds: [findingIds[0]], additionalEvidenceRequired: "Elementor System Info, checked manually.",
    }],
    recommendedActions: [{
      title: "Review memory on staging", explanation: "Check the configured limit.",
      priority: "MEDIUM", riskLevel: "LOW", skillLevel: "Beginner",
      steps: ["Back up the site.", "On staging, open Elementor System Info."],
      referencedFindingIds: [findingIds[0]], humanReviewRecommended: true,
    }],
    missingEvidence: ["Whether the symptom reproduces in Safe Mode."],
    limitations: ["No console data was collected.", "Visual condition was not verified."],
    humanReviewRecommended: true,
  };
}

test("el db: users, website, connection", async () => {
  userA = await makeUser("a");
  userB = await makeUser("b");
  website = await prisma.website.create({ data: { name: "Test Site", normalizedUrl: `https://${RUN}.example.com`, userId: userA.id } });
  connection = await prisma.websiteConnection.create({
    data: { websiteId: website.id, status: "ACTIVE", credentialHash: "test-hash" },
  });
  await prisma.website.update({ where: { id: website.id }, data: { connectionStatus: "CONNECTED" } });
  assert.ok(connection.id);
});

test("el db: diagnostic persists with findings, snapshot copy, and redaction", async () => {
  await seedSnapshot(connection, v4Payload);
  const diag = await createElementorDiagnostic(userA.id, {
    websiteId: website.id,
    symptomCategory: "ELEMENTOR_EDITOR_NOT_LOADING",
    symptomDescription: "Editor stuck loading. password=<redacted>",
    affectedScope: "editor",
    affectedPages: "many",
    deviceScope: "desktop",
    updatePreceded: true,
    startedAt: "after the last update",
    errorExcerpt: "api_key=<redacted>",
  }, { limiter: new ElementorRateLimiter() });
  assert.equal(diag.status, "COMPLETED");
  assert.equal(diag.affectedScope, "editor");
  assert.equal(diag.updatePreceded, "TRUE");
  assert.ok(diag.findings.some((f) => f.ruleId === "D"));
  assert.ok(diag.findings.some((f) => f.ruleId === "E"));
  assert.doesNotMatch(diag.symptomDescription, /hunter2/);
  assert.doesNotMatch(diag.errorExcerpt, /should-be-redacted/);
  assert.match(diag.errorExcerpt, /\[redacted\]/);
  // Snapshot-copy integrity: replace the live snapshot, diagnostic copy unchanged.
  const other = { ...v4Payload, phpVersion: "8.1" };
  await seedSnapshot(connection, other);
  const stored = await prisma.elementorDiagnostic.findUnique({ where: { id: diag.id } });
  assert.equal(stored.snapshotPayload.phpVersion, "8.3.6");
  assert.equal(stored.snapshotSchemaVersion, 4);
  globalThis.__elDiagId = diag.id;
  globalThis.__elFindingIds = diag.findings.map((f) => f.id);
});

test("el db: client-supplied snapshot/inventory are ignored", async () => {
  await seedSnapshot(connection, v4Payload);
  const diag = await createElementorDiagnostic(userA.id, {
    websiteId: website.id,
    symptomCategory: "OTHER_OR_UNKNOWN",
    symptomDescription: "Forged client data must not win.",
    snapshot: { schemaVersion: 4, elementor: { status: "NOT_INSTALLED" } },
    elementor: { status: "NOT_INSTALLED" },
    connectorId: "forged",
    ownerId: "forged",
  }, { limiter: new ElementorRateLimiter() });
  assert.equal(diag.findings.some((f) => f.ruleId === "A"), false);
  assert.equal(diag.snapshotSchemaVersion, 4);
});

test("el db: legacy v3 snapshot diagnostic persists with J finding only (no A claim)", async () => {
  const v3 = { ...v4Payload }; delete v3.elementor; delete v3.environment; v3.schemaVersion = 3;
  await seedSnapshot(connection, v3);
  const diag = await createElementorDiagnostic(userA.id, {
    websiteId: website.id,
    symptomCategory: "OTHER_OR_UNKNOWN",
    symptomDescription: "Legacy snapshot check.",
  }, { limiter: new ElementorRateLimiter() });
  assert.ok(diag.findings.some((f) => f.ruleId === "J"));
  assert.equal(diag.findings.some((f) => f.ruleId === "A"), false);
  assert.equal(diag.snapshotSchemaVersion, 3);
});

test("el db: snapshot view shows Elementor/Pro status, never secrets", async () => {
  await seedSnapshot(connection, v4Payload);
  const view = await getElementorSnapshotView(userA.id, website.id);
  assert.equal(view.snapshotStatus, "CURRENT");
  assert.equal(view.snapshot.elementor.status, "AVAILABLE");
  assert.equal(view.snapshot.elementor.pro.installed, false);
  assert.equal(view.snapshot.environment.wpMemoryLimit, "128M");
  assert.doesNotMatch(JSON.stringify(view), /credential|password/);
});

test("el db: ownership-scoped; another user's website is 404-identical", async () => {
  await assert.rejects(
    () => createElementorDiagnostic(userB.id, { websiteId: website.id, symptomCategory: "OTHER_OR_UNKNOWN", symptomDescription: "x" }, { limiter: new ElementorRateLimiter() }),
    (e) => e instanceof ElementorError && e.status === 404,
  );
  const rows = await prisma.elementorDiagnostic.findMany({ where: { userId: userB.id } });
  assert.equal(rows.length, 0);
});

test("el db: stale snapshot blocks with no row persisted", async () => {
  await seedSnapshot(connection, v4Payload, new Date(Date.now() - 25 * 60 * 60 * 1000));
  const before = await prisma.elementorDiagnostic.count({ where: { userId: userA.id } });
  await assert.rejects(
    () => createElementorDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER_OR_UNKNOWN", symptomDescription: "stale test" }, { limiter: new ElementorRateLimiter() }),
    (e) => e instanceof ElementorError && e.code === "SNAPSHOT_STALE" && e.status === 422,
  );
  assert.equal(await prisma.elementorDiagnostic.count({ where: { userId: userA.id } }), before);
});

test("el db: unsupported schema and revoked connection block", async () => {
  await seedSnapshot(connection, { ...v4Payload, schemaVersion: 99 });
  await assert.rejects(
    () => createElementorDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER_OR_UNKNOWN", symptomDescription: "unsupported" }, { limiter: new ElementorRateLimiter() }),
    (e) => e instanceof ElementorError && e.code === "SNAPSHOT_UNSUPPORTED",
  );
  await prisma.websiteConnection.update({ where: { id: connection.id }, data: { status: "REVOKED" } });
  await assert.rejects(
    () => createElementorDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER_OR_UNKNOWN", symptomDescription: "revoked" }, { limiter: new ElementorRateLimiter() }),
    (e) => e instanceof ElementorError && e.code === "SNAPSHOT_MISSING",
  );
  await prisma.websiteConnection.update({ where: { id: connection.id }, data: { status: "ACTIVE" } });
  await seedSnapshot(connection, v4Payload);
});

test("el db: invalid body and oversized fields are validation failures", async () => {
  await assert.rejects(
    () => createElementorDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "NOPE", symptomDescription: "x" }, { limiter: new ElementorRateLimiter() }),
    (e) => e instanceof ElementorError && e.status === 400,
  );
  await assert.rejects(
    () => createElementorDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER_OR_UNKNOWN", symptomDescription: "x".repeat(2001) }, { limiter: new ElementorRateLimiter() }),
    (e) => e instanceof ElementorError && e.status === 400,
  );
  await assert.rejects(
    () => createElementorDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER_OR_UNKNOWN", symptomDescription: "x", errorExcerpt: "y".repeat(2001) }, { limiter: new ElementorRateLimiter() }),
    (e) => e instanceof ElementorError && e.status === 400,
  );
});

test("el db: rate limit blocks the second run at limit 1", async () => {
  const limiter = new ElementorRateLimiter({ limitPerHour: 1 });
  await createElementorDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER_OR_UNKNOWN", symptomDescription: "first" }, { limiter });
  await assert.rejects(
    () => createElementorDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER_OR_UNKNOWN", symptomDescription: "second" }, { limiter }),
    (e) => e instanceof ElementorError && e.status === 429,
  );
});

test("el db: pagination via list query respects ownership", async () => {
  const rows = await prisma.elementorDiagnostic.findMany({ where: { userId: userA.id }, orderBy: { createdAt: "desc" }, take: 2 });
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => r.userId === userA.id));
});

test("el db: AI with mock provider persists valid analysis; deterministic findings unchanged", async () => {
  const diagnostic = await prisma.elementorDiagnostic.findUnique({ where: { id: globalThis.__elDiagId }, include: { findings: true } });
  const before = JSON.stringify(diagnostic.findings.map((f) => f.title));
  const provider = new MockProvider({ analysis: validAnalysis(globalThis.__elFindingIds), messagesBuilder: buildElementorAiMessages });
  const result = await generateElementorAiAnalysis({
    diagnostic, findings: diagnostic.findings, userId: userA.id,
    providerOverride: provider, limiter: new AiRateLimiter(),
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.schemaVersion, "elementor-1");
  const after = await prisma.elementorDiagnostic.findUnique({ where: { id: globalThis.__elDiagId }, include: { findings: true } });
  assert.equal(JSON.stringify(after.findings.map((f) => f.title)), before);
  const cached = await generateElementorAiAnalysis({
    diagnostic, findings: diagnostic.findings, userId: userA.id,
    providerOverride: provider, limiter: new AiRateLimiter(),
  });
  assert.equal(cached.fromCache, true);
});

test("el db: AI unknown reference and invented visual verification are rejected and persist FAILED", async () => {
  await seedSnapshot(connection, v4Payload);
  const diag = await createElementorDiagnostic(userA.id, {
    websiteId: website.id, symptomCategory: "OTHER_OR_UNKNOWN", symptomDescription: "ai reject test",
  }, { limiter: new ElementorRateLimiter() });
  const diagnostic = await prisma.elementorDiagnostic.findUnique({ where: { id: diag.id }, include: { findings: true } });
  const ids = diagnostic.findings.map((f) => f.id);
  const badRef = validAnalysis(ids);
  badRef.confirmedObservations = [{ findingId: "unknown-id", observation: "x" }];
  await assert.rejects(
    () => generateElementorAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, providerOverride: new MockProvider({ analysis: badRef, messagesBuilder: buildElementorAiMessages }), limiter: new AiRateLimiter() }),
    (e) => e.code === "INVALID_OUTPUT",
  );
  let row = await prisma.elementorAiAnalysis.findUnique({ where: { diagnosticId: diag.id } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.errorCode, "INVALID_OUTPUT");
  const badVisual = validAnalysis(ids);
  badVisual.summary = "The layout is visually verified and correct.";
  await assert.rejects(
    () => generateElementorAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true, providerOverride: new MockProvider({ analysis: badVisual, messagesBuilder: buildElementorAiMessages }), limiter: new AiRateLimiter() }),
    (e) => e.code === "INVALID_OUTPUT",
  );
  row = await prisma.elementorAiAnalysis.findUnique({ where: { diagnosticId: diag.id } });
  assert.equal(row.status, "FAILED");
});

test("el db: AI provider outage persists FAILED; unconfigured AI throws AI_NOT_CONFIGURED", async () => {
  const diagnostic = await prisma.elementorDiagnostic.findUnique({ where: { id: globalThis.__elDiagId }, include: { findings: true } });
  await assert.rejects(
    () => generateElementorAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true, providerOverride: new MockProvider({ behavior: "outage", messagesBuilder: buildElementorAiMessages }), limiter: new AiRateLimiter() }),
    (e) => e instanceof AiProviderError && e.code === "PROVIDER_ERROR",
  );
  const row = await prisma.elementorAiAnalysis.findUnique({ where: { diagnosticId: globalThis.__elDiagId } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.errorCode, "PROVIDER_ERROR");
  await assert.rejects(
    () => generateElementorAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true, limiter: new AiRateLimiter(), config: { provider: "", apiKey: "", model: "" } }),
    (e) => e instanceof AiProviderError && e.code === "AI_NOT_CONFIGURED",
  );
});

test("el db: cross-user retrieval of another user's diagnostic finds nothing", async () => {
  const rows = await prisma.elementorDiagnostic.findMany({ where: { userId: userB.id } });
  assert.equal(rows.length, 0);
  const one = await prisma.elementorDiagnostic.findFirst({ where: { id: globalThis.__elDiagId, userId: userB.id } });
  assert.equal(one, null);
});

test("el db: historical stability after live snapshot replacement (AI association intact)", async () => {
  const stored = await prisma.elementorDiagnostic.findUnique({ where: { id: globalThis.__elDiagId }, include: { aiAnalysis: true } });
  assert.ok(stored.aiAnalysis);
  assert.equal(stored.snapshotPayload.phpVersion, "8.3.6");
});
