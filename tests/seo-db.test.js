// Tool 11 DB tests. Run via scripts/run-db-tests.mjs with
// TEST_DATABASE_URL. No live provider, no live site probing: the engine
// is a deterministic stub; snapshot evidence is a fixture snapshot.
// Ownership, stale-snapshot blocking, URL-only scoping, client-data
// rejection, and sanitized storage are tested against the real database.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { createSeoDiagnostic, getSeoDiagnostic, listSeoDiagnostics, SeoError } from "../lib/seo/service.js";
import { generateSeoAiAnalysis } from "../lib/seo/ai.js";
import { MockProvider } from "../lib/ai/providers.js";
import { buildSeoAiMessages } from "../lib/seo/ai-prompt.js";
import { SeoRateLimiter } from "../lib/seo/rate-limit.js";
import { AiRateLimiter } from "../lib/ai/rate-limit.js";

const RUN = `seo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA, userB, websiteA, connectionA;

function v7Payload() {
  return {
    schemaVersion: 7,
    wordpressVersion: "7.1.3",
    phpVersion: "8.3.6",
    homeUrl: "https://example.com",
    siteUrl: "https://example.com",
    pluginVersion: "1.7.0",
    activePlugins: [{ name: "Rank Math", version: "1.0" }],
    activeTheme: { name: "Oishi", version: "1.0" },
    multisite: false,
    locale: "en_US",
    plugins: [
      { name: "Rank Math", slug: "rank-math", version: "1.0", active: true, networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: null, dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: null },
      { name: "Yoast SEO", slug: "wordpress-seo", version: "2.0", active: false, networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: null, dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: null },
    ],
    theme: { name: "Oishi", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null, slug: "oishi" },
    woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: false, active: false, version: null, pro: { installed: false, active: false, version: null }, status: "NOT_INSTALLED" },
    environment: { phpMemoryLimit: null, wpMemoryLimit: null, maxExecutionTime: null },
    contactForms: [], mailTransport: [],
    senderDomain: { senderConfigured: "unknown", senderDomain: null, domainMatches: null, comparisonEstablished: false },
    securityIndicators: { wpDebug: "no", wpDebugDisplay: "no", wpDebugLog: "no", disallowFileEdit: "yes" },
  };
}

function stubEngineResult() {
  return {
    sanitizedTargetUrl: "https://example.com/",
    requestedTarget: "https://example.com/",
    finalUrl: "https://example.com/",
    executionStatus: "COMPLETED",
    homepageSummary: { requestedUrl: "https://example.com/", finalUrl: "https://example.com/", finalStatus: 200, redirectCount: 0, title: { present: true, value: "Example", length: 7 } },
    robotsSummary: { present: true, status: 200, blocksHomepage: false, sitemapUrls: [] },
    sitemapSummary: { status: "OK", sitemapsChecked: 1, entryCount: 2, homepagePresent: true },
    spamSignals: { keywordCategories: [], externalLinkCount: 0, totalLinkCount: 0, hiddenLinkCount: 0 },
    seoPluginSummary: { status: "SEO_PLUGIN_ACTIVE", plugins: [], activeSlugs: ["rank-math"] },
    advisoryContext: null,
    searchConsoleStatus: "NOT_CONFIGURED",
    summary: { findingCodes: ["SEARCH_CONSOLE_NOT_CONFIGURED"] },
    limitations: ["Stub limitation."],
    findings: [{
      code: "SEARCH_CONSOLE_NOT_CONFIGURED", severity: "LOW", title: "Search Console is not connected",
      explanation: "No Search Console data was consulted.", evidence: {}, recommendation: "Check Search Console manually.",
      confidence: "HIGH", evidenceStatus: "OBSERVED", checkId: "search-console", evidenceCategory: null, limitations: null,
    }],
  };
}

const stubEngine = async () => stubEngineResult();
const freshLimiter = () => new SeoRateLimiter({ limitPerHour: 100 });

test("seo db: setup users, website, connection, fresh snapshot", async () => {
  userA = await prisma.user.create({ data: { name: "SEO A", email: `${RUN}-a@example.com` } });
  userB = await prisma.user.create({ data: { name: "SEO B", email: `${RUN}-b@example.com` } });
  websiteA = await prisma.website.create({
    data: { name: "Example", normalizedUrl: "https://example.com", userId: userA.id, connectionStatus: "CONNECTED" },
  });
  connectionA = await prisma.websiteConnection.create({
    data: { websiteId: websiteA.id, status: "ACTIVE", credentialHash: "hash-stub", pluginVersion: "1.7.0" },
  });
  await prisma.connectorDiagnosticSnapshot.create({
    data: { connectionId: connectionA.id, websiteId: websiteA.id, schemaVersion: 7, payload: v7Payload() },
  });
});

test("seo db: websiteId run persists report with snapshot plugin evidence", async () => {
  const d = await createSeoDiagnostic(userA.id, { websiteId: websiteA.id }, { engine: stubEngine, limiter: freshLimiter() });
  assert.equal(d.websiteId, websiteA.id);
  assert.equal(d.snapshotSchemaVersion, 7);
  assert.equal(d.snapshotFreshness, "CURRENT");
  assert.equal(d.searchConsoleStatus, "NOT_CONFIGURED");
  assert.equal(d.seoPluginSummary.activeSlugs[0], "rank-math");
  assert.ok(d.findings.some((f) => f.code === "SEARCH_CONSOLE_NOT_CONFIGURED"));
  const loaded = await getSeoDiagnostic(userA.id, d.id);
  assert.ok(loaded);
  assert.equal(loaded.findings.length, 1);
});

test("seo db: ownership enforced — other user gets identical 404", async () => {
  const d = await createSeoDiagnostic(userA.id, { websiteId: websiteA.id }, { engine: stubEngine, limiter: freshLimiter() });
  assert.equal(await getSeoDiagnostic(userB.id, d.id), null);
  await assert.rejects(
    createSeoDiagnostic(userB.id, { websiteId: websiteA.id }, { engine: stubEngine, limiter: freshLimiter() }),
    (e) => e instanceof SeoError && e.code === "WEBSITE_NOT_FOUND" && e.status === 404,
  );
});

test("seo db: URL-only run persists without website/snapshot; client findings ignored", async () => {
  const d = await createSeoDiagnostic(userA.id, {
    url: "https://example.org/",
    findings: [{ code: "FAKE", severity: "HIGH" }],
    seoPluginSummary: { status: "FAKE" },
  }, { engine: stubEngine, limiter: freshLimiter() });
  assert.equal(d.websiteId, null);
  assert.equal(d.snapshotSchemaVersion, null);
  assert.equal(d.snapshotFreshness, "NOT_APPLICABLE");
  assert.ok(!d.findings.some((f) => f.code === "FAKE"));
  assert.ok(d.limitations.some((l) => /URL-only/.test(l)));
});

test("seo db: url alongside websiteId is ignored (owned record URL wins)", async () => {
  let seenUrl = null;
  const spy = async (url) => { seenUrl = url; return stubEngineResult(); };
  await createSeoDiagnostic(userA.id, { websiteId: websiteA.id, url: "https://attacker.example/" }, { engine: spy, limiter: freshLimiter() });
  assert.equal(seenUrl, "https://example.com");
});

test("seo db: stale snapshot blocks with 422 and persists no row", async () => {
  const before = await prisma.seoDiagnostic.count({ where: { userId: userA.id } });
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: connectionA.id } });
  await prisma.connectorDiagnosticSnapshot.create({
    data: {
      connectionId: connectionA.id, websiteId: websiteA.id, schemaVersion: 7, payload: v7Payload(),
      receivedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    },
  });
  await assert.rejects(
    createSeoDiagnostic(userA.id, { websiteId: websiteA.id }, { engine: stubEngine, limiter: freshLimiter() }),
    (e) => e instanceof SeoError && e.code === "SNAPSHOT_STALE" && e.status === 422,
  );
  const after = await prisma.seoDiagnostic.count({ where: { userId: userA.id } });
  assert.equal(after, before);
  // Restore a fresh snapshot for later tests.
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: connectionA.id } });
  await prisma.connectorDiagnosticSnapshot.create({
    data: { connectionId: connectionA.id, websiteId: websiteA.id, schemaVersion: 7, payload: v7Payload() },
  });
});

test("seo db: list is own-only, desc, bounded paging", async () => {
  const { diagnostics, total } = await listSeoDiagnostics(userA.id, { page: 1, pageSize: 2 });
  assert.ok(total >= 3);
  assert.ok(diagnostics.length <= 2);
  const other = await listSeoDiagnostics(userB.id, { page: 1, pageSize: 20 });
  assert.equal(other.total, 0);
});

test("seo db: AI analysis via mock provider stores seo-1 output; input has no bodies", async () => {
  const d = await createSeoDiagnostic(userA.id, { websiteId: websiteA.id }, { engine: stubEngine, limiter: freshLimiter() });
  const loaded = await getSeoDiagnostic(userA.id, d.id);
  const capture = [];
  const analysis = {
    schemaVersion: "seo-1",
    summary: "The homepage carries no blocking signals in this stub report; Search Console was not consulted.",
    explanation: "The deterministic report shows a completed check with only the Search Console info finding.",
    diagnosticConfidence: "MEDIUM",
    confirmedObservations: [{ findingId: loaded.findings[0].id, observation: "Search Console is not connected." }],
    causeHypotheses: [],
    recommendedActions: [{ title: "Check Search Console manually", description: "Use URL Inspection for real index status.", priority: "MEDIUM" }],
    missingEvidence: ["Search Console data"],
    limitations: ["Head evidence covers the first 64 KiB only."],
    humanReviewRecommended: true,
  };
  const provider = new MockProvider({ analysis, capture, messagesBuilder: buildSeoAiMessages });
  const result = await generateSeoAiAnalysis({
    diagnostic: loaded, findings: loaded.findings, userId: userA.id,
    providerOverride: provider, limiter: new AiRateLimiter({ limitPerDay: 100 }),
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.schemaVersion, "seo-1");
  const sent = JSON.stringify(capture[0].messages);
  assert.ok(!sent.includes("<html"));
  assert.ok(sent.includes("UNTRUSTED diagnostic data"));
});

test("seo db: cleanup own test data", async () => {
  await prisma.seoDiagnostic.deleteMany({ where: { userId: userA.id } });
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: connectionA.id } });
  await prisma.websiteConnection.delete({ where: { id: connectionA.id } });
  await prisma.website.delete({ where: { id: websiteA.id } });
  await prisma.user.delete({ where: { id: userA.id } });
  await prisma.user.delete({ where: { id: userB.id } });
});
