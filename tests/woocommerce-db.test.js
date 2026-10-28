// Milestone 7 DB tests (run via scripts/run-db-tests.mjs with TEST_DATABASE_URL).
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { createWooCommerceDiagnostic, WooCommerceError } from "../lib/woocommerce/service.js";
import { generateWooAiAnalysis } from "../lib/woocommerce/ai.js";
import { MockProvider, AiProviderError } from "../lib/ai/providers.js";
import { buildWooAiMessages } from "../lib/woocommerce/ai-prompt.js";
import { WooRateLimiter } from "../lib/woocommerce/rate-limit.js";
import { AiRateLimiter } from "../lib/ai/rate-limit.js";

const RUN = `woo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA, userB, website, connection;

const v3Payload = {
  schemaVersion: 3,
  wordpressVersion: "7.1.3",
  phpVersion: "8.3.6",
  homeUrl: "https://example.com",
  siteUrl: "https://example.com",
  pluginVersion: "1.2.0",
  activePlugins: [{ name: "WooCommerce", version: "11.2.1" }],
  activeTheme: { name: "Theme", version: "1.0" },
  multisite: false,
  locale: "en_US",
  plugins: [{
    name: "WooCommerce", slug: "woocommerce", version: "11.2.1", active: true,
    networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: null,
    dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: 1700000000,
  }],
  theme: { name: "Theme", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null },
  woocommerce: {
    installed: true, active: true, version: "11.2.1", status: "AVAILABLE",
    pages: {
      cart: { pageId: 11, exists: true, status: "publish", implementation: "block" },
      checkout: { pageId: 12, exists: true, status: "publish", implementation: "block" },
      myAccount: { pageId: 13, exists: true, status: "publish", implementation: "classic-shortcode" },
    },
    gateways: [{ id: "cod", title: "Cash on delivery", enabled: false, available: null, blockCompatibility: "UNKNOWN", blockCompatibilitySource: "not-determined" }],
  },
};

async function makeUser(suffix) {
  return prisma.user.create({ data: { name: "Woo Tester", email: `${RUN}-${suffix}@example.invalid` } });
}
async function seedSnapshot(conn, payload, receivedAt = new Date()) {
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: conn.id } });
  return prisma.connectorDiagnosticSnapshot.create({
    data: { connectionId: conn.id, websiteId: conn.websiteId, schemaVersion: payload.schemaVersion, payload, receivedAt },
  });
}
function validAnalysis(findingIds) {
  return {
    schemaVersion: "woocommerce-1",
    summary: "No gateway is enabled, so checkout shows no payment method.",
    explanation: "The snapshot shows a published block checkout and zero enabled gateways.",
    diagnosticConfidence: "MEDIUM",
    confirmedObservations: [{ findingId: findingIds[0], observation: "No gateway is enabled." }],
    causeHypotheses: [{
      title: "Missing enabled gateway", explanation: "With no enabled gateway, no payment method appears.",
      confidence: "MEDIUM", supportingFindingIds: [findingIds[0]], additionalEvidenceRequired: "Payments settings, checked manually.",
    }],
    recommendedActions: [{
      title: "Review Payments settings on staging", explanation: "Check enabled gateways.",
      priority: "MEDIUM", riskLevel: "LOW", skillLevel: "Beginner",
      steps: ["Back up the site.", "On staging, open WooCommerce Settings Payments."],
      referencedFindingIds: [findingIds[0]], humanReviewRecommended: true,
    }],
    missingEvidence: ["Whether a manual payment workflow exists."],
    limitations: ["Orders and transactions were not inspected."],
    humanReviewRecommended: true,
  };
}

test("woo db: users, website, connection", async () => {
  userA = await makeUser("a");
  userB = await makeUser("b");
  website = await prisma.website.create({ data: { name: "Test Shop", normalizedUrl: `https://${RUN}.example.com`, userId: userA.id } });
  connection = await prisma.websiteConnection.create({
    data: { websiteId: website.id, status: "ACTIVE", credentialHash: "test-hash" },
  });
  await prisma.website.update({ where: { id: website.id }, data: { connectionStatus: "CONNECTED" } });
  assert.ok(connection.id);
});

test("woo db: diagnostic persists with findings, snapshot copy, and redaction", async () => {
  await seedSnapshot(connection, v3Payload);
  const diag = await createWooCommerceDiagnostic(userA.id, {
    websiteId: website.id,
    symptomCategory: "NO_PAYMENT_METHODS",
    symptomDescription: "No payment methods show. password=hunter2 should be redacted.",
    checkoutType: "BLOCK",
    affectedScope: "MULTIPLE",
    startedAt: "after the last update",
    errorExcerpt: "api_key=should-be-redacted",
  }, { limiter: new WooRateLimiter() });
  assert.equal(diag.status, "COMPLETED");
  assert.equal(diag.checkoutType, "BLOCK");
  assert.equal(diag.affectedScope, "MULTIPLE");
  assert.equal(diag.startedAt, "after the last update");
  assert.ok(diag.findings.some((f) => f.ruleId === "F"));
  assert.doesNotMatch(diag.symptomDescription, /hunter2/);
  assert.doesNotMatch(diag.errorExcerpt, /should-be-redacted/);
  assert.match(diag.errorExcerpt, /\[redacted\]/);
  // Snapshot-copy integrity: replace the live snapshot, diagnostic copy unchanged.
  const other = { ...v3Payload, phpVersion: "8.1" };
  await seedSnapshot(connection, other);
  const stored = await prisma.wooCommerceDiagnostic.findUnique({ where: { id: diag.id } });
  assert.equal(stored.snapshotPayload.phpVersion, "8.3.6");
  assert.equal(stored.snapshotSchemaVersion, 3);
  globalThis.__wooDiagId = diag.id;
  globalThis.__wooFindingIds = diag.findings.map((f) => f.id);
});

test("woo db: client-supplied snapshot/gateway config/payment status are ignored", async () => {
  await seedSnapshot(connection, v3Payload);
  const diag = await createWooCommerceDiagnostic(userA.id, {
    websiteId: website.id,
    symptomCategory: "OTHER",
    symptomDescription: "Forged client data must not win.",
    snapshot: { schemaVersion: 3, woocommerce: { status: "NOT_INSTALLED" } },
    gateways: [{ id: "fake", enabled: true }],
    paymentStatus: "succeeded",
    connectorId: "forged",
    ownerId: "forged",
  }, { limiter: new WooRateLimiter() });
  // Stored snapshot is the real one (AVAILABLE), not the forged NOT_INSTALLED.
  assert.equal(diag.findings.some((f) => f.ruleId === "A"), false);
  assert.equal(diag.snapshotSchemaVersion, 3);
});

test("woo db: legacy v2 snapshot diagnostic persists with K finding only (no A claim)", async () => {
  const v2 = { ...v3Payload }; delete v2.woocommerce; v2.schemaVersion = 2;
  await seedSnapshot(connection, v2);
  const diag = await createWooCommerceDiagnostic(userA.id, {
    websiteId: website.id,
    symptomCategory: "OTHER",
    symptomDescription: "Legacy snapshot check.",
  }, { limiter: new WooRateLimiter() });
  assert.ok(diag.findings.some((f) => f.ruleId === "K"));
  assert.equal(diag.findings.some((f) => f.ruleId === "A"), false);
  assert.equal(diag.snapshotSchemaVersion, 2);
});

test("woo db: ownership-scoped; another user's website is 404-identical", async () => {
  await assert.rejects(
    () => createWooCommerceDiagnostic(userB.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "x" }, { limiter: new WooRateLimiter() }),
    (e) => e instanceof WooCommerceError && e.status === 404,
  );
  const rows = await prisma.wooCommerceDiagnostic.findMany({ where: { userId: userB.id } });
  assert.equal(rows.length, 0);
});

test("woo db: stale snapshot blocks with no row persisted", async () => {
  await seedSnapshot(connection, v3Payload, new Date(Date.now() - 25 * 60 * 60 * 1000));
  const before = await prisma.wooCommerceDiagnostic.count({ where: { userId: userA.id } });
  await assert.rejects(
    () => createWooCommerceDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "stale test" }, { limiter: new WooRateLimiter() }),
    (e) => e instanceof WooCommerceError && e.code === "SNAPSHOT_STALE" && e.status === 422,
  );
  assert.equal(await prisma.wooCommerceDiagnostic.count({ where: { userId: userA.id } }), before);
});

test("woo db: unsupported schema and revoked connection block", async () => {
  await seedSnapshot(connection, { ...v3Payload, schemaVersion: 99 });
  await assert.rejects(
    () => createWooCommerceDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "unsupported" }, { limiter: new WooRateLimiter() }),
    (e) => e instanceof WooCommerceError && e.code === "SNAPSHOT_UNSUPPORTED",
  );
  await prisma.websiteConnection.update({ where: { id: connection.id }, data: { status: "REVOKED" } });
  await assert.rejects(
    () => createWooCommerceDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "revoked" }, { limiter: new WooRateLimiter() }),
    (e) => e instanceof WooCommerceError && e.code === "SNAPSHOT_MISSING",
  );
  await prisma.websiteConnection.update({ where: { id: connection.id }, data: { status: "ACTIVE" } });
  await seedSnapshot(connection, v3Payload);
});

test("woo db: invalid body and oversized fields are validation failures", async () => {
  await assert.rejects(
    () => createWooCommerceDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "NOPE", symptomDescription: "x" }, { limiter: new WooRateLimiter() }),
    (e) => e instanceof WooCommerceError && e.status === 400,
  );
  await assert.rejects(
    () => createWooCommerceDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "x".repeat(2001) }, { limiter: new WooRateLimiter() }),
    (e) => e instanceof WooCommerceError && e.status === 400,
  );
});

test("woo db: rate limit blocks the second run at limit 1", async () => {
  const limiter = new WooRateLimiter({ limitPerHour: 1 });
  await createWooCommerceDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "first" }, { limiter });
  await assert.rejects(
    () => createWooCommerceDiagnostic(userA.id, { websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "second" }, { limiter }),
    (e) => e instanceof WooCommerceError && e.status === 429,
  );
});

test("woo db: AI with mock provider persists valid analysis; deterministic findings unchanged", async () => {
  const diagnostic = await prisma.wooCommerceDiagnostic.findUnique({ where: { id: globalThis.__wooDiagId }, include: { findings: true } });
  const before = JSON.stringify(diagnostic.findings.map((f) => f.title));
  const provider = new MockProvider({ analysis: validAnalysis(globalThis.__wooFindingIds), messagesBuilder: buildWooAiMessages });
  const result = await generateWooAiAnalysis({
    diagnostic, findings: diagnostic.findings, userId: userA.id,
    providerOverride: provider, limiter: new AiRateLimiter(),
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.schemaVersion, "woocommerce-1");
  const after = await prisma.wooCommerceDiagnostic.findUnique({ where: { id: globalThis.__wooDiagId }, include: { findings: true } });
  assert.equal(JSON.stringify(after.findings.map((f) => f.title)), before);
  const cached = await generateWooAiAnalysis({
    diagnostic, findings: diagnostic.findings, userId: userA.id,
    providerOverride: provider, limiter: new AiRateLimiter(),
  });
  assert.equal(cached.fromCache, true);
});

test("woo db: AI unknown reference and invented payment success are rejected and persist FAILED", async () => {
  await seedSnapshot(connection, v3Payload);
  const diag = await createWooCommerceDiagnostic(userA.id, {
    websiteId: website.id, symptomCategory: "OTHER", symptomDescription: "ai reject test",
  }, { limiter: new WooRateLimiter() });
  const diagnostic = await prisma.wooCommerceDiagnostic.findUnique({ where: { id: diag.id }, include: { findings: true } });
  const ids = diagnostic.findings.map((f) => f.id);
  const badRef = validAnalysis(ids);
  badRef.confirmedObservations = [{ findingId: "unknown-id", observation: "x" }];
  await assert.rejects(
    () => generateWooAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, providerOverride: new MockProvider({ analysis: badRef, messagesBuilder: buildWooAiMessages }), limiter: new AiRateLimiter() }),
    (e) => e.code === "INVALID_OUTPUT",
  );
  let row = await prisma.wooCommerceAiAnalysis.findUnique({ where: { diagnosticId: diag.id } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.errorCode, "INVALID_OUTPUT");
  const badSuccess = validAnalysis(ids);
  badSuccess.explanation = "The payment was successful.";
  await assert.rejects(
    () => generateWooAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true, providerOverride: new MockProvider({ analysis: badSuccess, messagesBuilder: buildWooAiMessages }), limiter: new AiRateLimiter() }),
    (e) => e.code === "INVALID_OUTPUT",
  );
  row = await prisma.wooCommerceAiAnalysis.findUnique({ where: { diagnosticId: diag.id } });
  assert.equal(row.status, "FAILED");
});

test("woo db: AI provider outage persists FAILED; unconfigured AI throws AI_NOT_CONFIGURED", async () => {
  const diagnostic = await prisma.wooCommerceDiagnostic.findUnique({ where: { id: globalThis.__wooDiagId }, include: { findings: true } });
  await assert.rejects(
    () => generateWooAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true, providerOverride: new MockProvider({ behavior: "outage", messagesBuilder: buildWooAiMessages }), limiter: new AiRateLimiter() }),
    (e) => e instanceof AiProviderError && e.code === "PROVIDER_ERROR",
  );
  const row = await prisma.wooCommerceAiAnalysis.findUnique({ where: { diagnosticId: globalThis.__wooDiagId } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.errorCode, "PROVIDER_ERROR");
  await assert.rejects(
    () => generateWooAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true, limiter: new AiRateLimiter(), config: { provider: "", apiKey: "", model: "" } }),
    (e) => e instanceof AiProviderError && e.code === "AI_NOT_CONFIGURED",
  );
});

test("woo db: cross-user retrieval of another user's diagnostic finds nothing", async () => {
  const rows = await prisma.wooCommerceDiagnostic.findMany({ where: { userId: userB.id } });
  assert.equal(rows.length, 0);
  const one = await prisma.wooCommerceDiagnostic.findFirst({ where: { id: globalThis.__wooDiagId, userId: userB.id } });
  assert.equal(one, null);
});
