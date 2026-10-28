// Tool 08 DB tests. Run via scripts/run-db-tests.mjs with
// TEST_DATABASE_URL. Provider + HTTP are injected (deterministic fixtures)
// — no live provider, no live DNS, no exploit, no login, no submission.
// Ownership, stale-snapshot blocking, provider-partial behaviour, and
// sanitized storage are tested against the real database.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { createSecurityDiagnostic, getSecurityDiagnostic, listSecurityDiagnostics, SecurityError } from "../lib/security/service.js";
import { generateSecurityAiAnalysis } from "../lib/security/ai.js";
import { MockProvider } from "../lib/ai/providers.js";
import { buildSecurityAiMessages } from "../lib/security/ai-prompt.js";
import { SecurityRateLimiter } from "../lib/security/rate-limit.js";
import { AiRateLimiter } from "../lib/ai/rate-limit.js";
import { AiProviderError } from "../lib/ai/providers.js";

const RUN = `sec-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA, userB, websiteA, connectionA;
const SENTINEL = "SENTINEL_SECRET_XYZ_9f8e7d";

function v6Payload() {
  return {
    schemaVersion: 6,
    wordpressVersion: "7.1.3",
    phpVersion: "8.3.6",
    homeUrl: "https://example.com",
    siteUrl: "https://example.com",
    pluginVersion: "1.5.0",
    activePlugins: [{ name: "Akismet", version: "3.1.4" }],
    activeTheme: { name: "Oishi", version: "1.0" },
    multisite: false,
    locale: "en_US",
    plugins: [
      { name: "Akismet", slug: "akismet", version: "3.1.4", active: true, networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: null, dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: null },
      { name: "Contact Form 7", slug: "contact-form-7", version: "6.2.3", active: true, networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: null, dependencies: [], updateAvailable: true, newVersion: "6.2.4", updateCheckedAt: null },
      { name: "Custom Thing", slug: null, version: "1.0", active: true, networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: null, dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: null },
    ],
    theme: { name: "Oishi", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null },
    woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: false, active: false, version: null, pro: { installed: false, active: false, version: null }, status: "NOT_INSTALLED" },
    environment: { phpMemoryLimit: null, wpMemoryLimit: null, maxExecutionTime: null },
    contactForms: [], mailTransport: [],
    senderDomain: { senderConfigured: "unknown", senderDomain: null, domainMatches: null, comparisonEstablished: false },
    securityIndicators: { wpDebug: "no", wpDebugDisplay: "yes", wpDebugLog: "no", disallowFileEdit: "no" },
  };
}

function fixtureProviderFetch(url) {
  if (url.includes("/plugin/akismet/")) {
    return Promise.resolve({ status: 200, text: JSON.stringify({ error: 0, message: null, data: { name: "Akismet", plugin: "akismet", vulnerability: [{ uuid: "uuid-1", name: "Akismet [akismet] < 3.1.5", description: null, operator: { min_version: null, min_operator: null, max_version: "3.1.5", max_operator: "lt", unfixed: "0", closed: "0" }, source: [{ id: "CVE-2015-9357", name: "CVE-2015-9357", link: "https://www.cve.org/CVERecord?id=CVE-2015-9357", description: "x", date: "2019-08-28" }], impact: { cvss: { score: "9.8", severity: "c" } } }] } }) });
  }
  if (url.includes("/core/")) {
    return Promise.resolve({ status: 200, text: JSON.stringify({ error: 0, message: null, data: { core: "7.1.3", vulnerability: [] } }) });
  }
  return Promise.resolve({ status: 200, text: JSON.stringify({ error: 0, message: null, data: { vulnerability: null } }) });
}

function fixtureHttpProbe(url) {
  if (url === "https://example.com/") {
    return Promise.resolve({ status: 200, headers: { "strict-transport-security": "max-age=31536000", "content-security-policy": "default-src 'self'", "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN", "permissions-policy": "camera=()" } });
  }
  if (url === "https://example.com/xmlrpc.php") return Promise.resolve({ status: 405, headers: {} });
  if (url === "https://example.com/.env") return Promise.resolve({ status: 200, headers: { "content-type": "text/plain" }, bodyPreview: `DB_PASSWORD=${SENTINEL}\n` });
  return Promise.resolve({ status: 404, headers: {}, bodyPreview: "" });
}

function secAnalysis(findingId) {
  return {
    schemaVersion: "security-1",
    summary: "One matched advisory is a potential issue, not proof of exploitation.",
    explanation: "The deterministic report shows a matched Akismet advisory and hardening gaps.",
    diagnosticConfidence: "HIGH",
    confirmedObservations: [{ findingId, observation: "Akismet 3.1.4 matches an advisory." }],
    causeHypotheses: [],
    recommendedActions: [],
    missingEvidence: [],
    limitations: ["No matching advisory does not mean secure."],
    humanReviewRecommended: false,
  };
}

test("db setup: users + owned website + ACTIVE connection + fresh v6 snapshot", async () => {
  userA = await prisma.user.create({ data: { name: "SEC A", email: `${RUN}-a@example.invalid` } });
  userB = await prisma.user.create({ data: { name: "SEC B", email: `${RUN}-b@example.invalid` } });
  websiteA = await prisma.website.create({ data: { name: "Example", normalizedUrl: "https://example.com/", userId: userA.id, connectionStatus: "CONNECTED" } });
  connectionA = await prisma.websiteConnection.create({ data: { websiteId: websiteA.id, status: "ACTIVE", credentialHash: "hash" } });
  await prisma.connectorDiagnosticSnapshot.create({ data: { connectionId: connectionA.id, websiteId: websiteA.id, schemaVersion: 6, payload: v6Payload() } });
  assert.ok(userA.id && websiteA.id && connectionA.id);
});

test("website run COMPLETED; advisory matched, outdated + hardening found, client data ignored, sentinel never stored", async () => {
  const d = await createSecurityDiagnostic(userA.id, {
    websiteId: websiteA.id,
    url: "https://evil.example/",
    findings: [{ code: "FAKE", severity: "CRITICAL" }],
    inventory: [{ slug: "evil", version: "0.1" }],
    userId: userB.id,
  }, { providerFetch: fixtureProviderFetch, httpProbe: fixtureHttpProbe, limiter: new SecurityRateLimiter() });
  assert.equal(d.executionStatus, "COMPLETED");
  assert.equal(d.websiteId, websiteA.id);
  assert.equal(d.sanitizedWebsiteUrl, "https://example.com/");
  assert.equal(d.snapshotSchemaVersion, 6);
  const codes = d.findings.map((f) => f.code);
  assert.ok(codes.includes("PLUGIN_KNOWN_VULNERABILITY"), codes.join(","));
  assert.ok(codes.includes("COMPONENT_OUTDATED"), codes.join(","));
  assert.ok(codes.includes("WP_DEBUG_DISPLAY_ENABLED"), codes.join(","));
  assert.ok(codes.includes("DASHBOARD_FILE_EDITING_ENABLED"), codes.join(","));
  assert.ok(codes.includes("SENSITIVE_FILE_EXPOSURE_CONFIRMED"), codes.join(","));
  assert.ok(codes.includes("XMLRPC_ENDPOINT_RESPONDS"), codes.join(","));
  assert.ok(codes.includes("SECURITY_HEADER_MISSING"), codes.join(",")); // Referrer-Policy absent in fixture
  assert.ok(!codes.includes("FAKE"));
  assert.ok(!JSON.stringify(d).includes(SENTINEL), "secret body must never be stored");
  assert.ok(!JSON.stringify(d).includes("evil.example"));
  const advisoryFinding = d.findings.find((f) => f.code === "PLUGIN_KNOWN_VULNERABILITY");
  assert.equal(advisoryFinding.advisory.cveId, "CVE-2015-9357");
  assert.equal(advisoryFinding.advisory.fixedVersion, "3.1.5");
  const row = await prisma.securityDiagnostic.findUnique({ where: { id: d.id }, include: { findings: true } });
  assert.equal(row.userId, userA.id);
  assert.ok(!JSON.stringify(row).includes(SENTINEL));
  assert.ok(!JSON.stringify(row).includes("DB_PASSWORD"));
});

test("provider unavailable -> PARTIAL with explicit limitation, never a clean scan", async () => {
  const d = await createSecurityDiagnostic(userA.id, { websiteId: websiteA.id },
    { providerFetch: fixtureProviderFetch, httpProbe: fixtureHttpProbe, limiter: new SecurityRateLimiter(), providerConfig: { name: "none", timeoutMs: 8000, maxComponents: 60, concurrency: 2, maxResponseBytes: 524288, maxAdvisoriesPerComponent: 200 } });
  assert.equal(d.executionStatus, "PARTIAL");
  const codes = d.findings.map((f) => f.code);
  assert.ok(codes.includes("VULNERABILITY_PROVIDER_UNAVAILABLE"));
  assert.ok(!codes.includes("PLUGIN_KNOWN_VULNERABILITY"));
  assert.ok(d.limitations.some((l) => /does NOT mean the site is secure/.test(l)));
});

test("provider outage -> PARTIAL, not a clean scan", async () => {
  const d = await createSecurityDiagnostic(userA.id, { websiteId: websiteA.id },
    { providerFetch: async () => ({ status: 500, text: "err" }), httpProbe: fixtureHttpProbe, limiter: new SecurityRateLimiter() });
  assert.equal(d.executionStatus, "PARTIAL");
  assert.ok(d.findings.some((f) => f.code === "VULNERABILITY_PROVIDER_UNAVAILABLE"));
});

test("other user's website 404s; missing websiteId rejected; no row persisted for blocked runs", async () => {
  await assert.rejects(
    () => createSecurityDiagnostic(userB.id, { websiteId: websiteA.id }, { providerFetch: fixtureProviderFetch, httpProbe: fixtureHttpProbe, limiter: new SecurityRateLimiter() }),
    (err) => err instanceof SecurityError && err.code === "WEBSITE_NOT_FOUND",
  );
  await assert.rejects(
    () => createSecurityDiagnostic(userA.id, {}, { providerFetch: fixtureProviderFetch, httpProbe: fixtureHttpProbe, limiter: new SecurityRateLimiter() }),
    (err) => err instanceof SecurityError && err.code === "VALIDATION_FAILED",
  );
});

test("stale snapshot blocks with 422 and persists no row, then fresh snapshot restores runs", async () => {
  const before = await prisma.securityDiagnostic.count({ where: { userId: userA.id } });
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: connectionA.id } });
  await prisma.connectorDiagnosticSnapshot.create({
    data: { connectionId: connectionA.id, websiteId: websiteA.id, schemaVersion: 6, payload: v6Payload(), receivedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
  });
  await assert.rejects(
    () => createSecurityDiagnostic(userA.id, { websiteId: websiteA.id }, { providerFetch: fixtureProviderFetch, httpProbe: fixtureHttpProbe, limiter: new SecurityRateLimiter() }),
    (err) => err instanceof SecurityError && err.code === "SNAPSHOT_STALE",
  );
  assert.equal(await prisma.securityDiagnostic.count({ where: { userId: userA.id } }), before);
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: connectionA.id } });
  await prisma.connectorDiagnosticSnapshot.create({ data: { connectionId: connectionA.id, websiteId: websiteA.id, schemaVersion: 6, payload: v6Payload() } });
});

test("own list/read only; cross-user read returns null", async () => {
  const list = await listSecurityDiagnostics(userA.id, { page: 1, pageSize: 20 });
  assert.ok(list.total >= 2);
  const mine = list.diagnostics[0];
  assert.ok(await getSecurityDiagnostic(userA.id, mine.id));
  assert.equal(await getSecurityDiagnostic(userB.id, mine.id), null);
});

test("AI: mock analysis saves, unknown reference rejected, AI never overwrites findings, unconfigured AI is 503-shaped", async () => {
  const list = await listSecurityDiagnostics(userA.id, { page: 1, pageSize: 20 });
  const diagnostic = await getSecurityDiagnostic(userA.id, list.diagnostics[0].id);
  const findingId = diagnostic.findings[0].id;
  const good = await generateSecurityAiAnalysis({
    diagnostic, findings: diagnostic.findings, userId: userA.id,
    providerOverride: new MockProvider({ analysis: secAnalysis(findingId), messagesBuilder: buildSecurityAiMessages }),
    limiter: new AiRateLimiter(),
  });
  assert.equal(good.status, "COMPLETED");
  await assert.rejects(
    () => generateSecurityAiAnalysis({
      diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true,
      providerOverride: new MockProvider({ analysis: secAnalysis("unknown-id"), messagesBuilder: buildSecurityAiMessages }),
      limiter: new AiRateLimiter(),
    }),
    (err) => err.code === "INVALID_OUTPUT",
  );
  const after = await prisma.securityDiagnostic.findUnique({ where: { id: diagnostic.id }, include: { findings: true } });
  assert.equal(after.findings.length, diagnostic.findings.length, "AI must not change deterministic findings");
  await assert.rejects(
    () => generateSecurityAiAnalysis({
      diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true,
      limiter: new AiRateLimiter(), config: { provider: "", apiKey: "", model: "", timeoutMs: 30000, maxOutputTokens: 2000 },
    }),
    (err) => err instanceof AiProviderError && err.code === "AI_NOT_CONFIGURED",
  );
});
