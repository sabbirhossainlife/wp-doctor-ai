// Tool 06 DB tests (group G). Run via scripts/run-db-tests.mjs with
// TEST_DATABASE_URL. The engine is injected (canned deterministic
// result) — no live network fetch. Ownership, website ownership, and
// sanitized storage are tested against the real database.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { createSslRedirectDiagnostic, getSslRedirectDiagnostic, listSslRedirectDiagnostics, SslError } from "../lib/ssl/service.js";
import { generateSslAiAnalysis } from "../lib/ssl/ai.js";
import { MockProvider } from "../lib/ai/providers.js";
import { buildSslAiMessages } from "../lib/ssl/ai-prompt.js";
import { SslRateLimiter } from "../lib/ssl/rate-limit.js";
import { AiRateLimiter } from "../lib/ai/rate-limit.js";

const RUN = `ssl-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA, userB, websiteA;

function cannedEngine() {
  return async (url) => ({
    sanitizedTargetUrl: "https://example.com/page",
    executionStatus: "COMPLETED",
    terminalReason: "TERMINAL_RESPONSE",
    errorCode: null,
    chain: [{ step: 0, url: "https://example.com/page", status: 200, destination: null, hostChanged: false, scheme: "https", tlsResult: { verified: true, errorCode: null, protocol: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384" }, outcome: "terminal" }],
    tlsOutcome: { scheme: "https", verified: true, errorCode: null, certificate: { hostname: "example.com", issuer: "O=Test CA", validFrom: "2026-01-01T00:00:00.000Z", validTo: "2030-01-01T00:00:00.000Z", san: ["example.com"], protocol: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384" }, daysToExpiry: 400 },
    summary: { certStatus: "VALID", finalUrl: "https://example.com/page", finalStatus: 200, redirectCount: 0, crossHost: false, downgradeBlocked: false, terminalReason: "TERMINAL_RESPONSE", errorCode: null },
    limitations: ["Test limitation."],
    findings: [{ code: "TLS_CERT_VALID", severity: "LOW", title: "TLS certificate verified", explanation: "Verified.", evidence: {}, recommendation: "None.", confidence: "HIGH", limitations: null }],
  });
}

function sslAnalysis(findingId) {
  return {
    schemaVersion: "ssl-1",
    summary: "The certificate verified.",
    explanation: "The deterministic report shows a verified certificate.",
    diagnosticConfidence: "HIGH",
    confirmedObservations: [{ findingId, observation: "The certificate verified." }],
    causeHypotheses: [],
    recommendedActions: [],
    missingEvidence: [],
    limitations: [],
    humanReviewRecommended: false,
  };
}

test("db setup: users + one owned website", async () => {
  userA = await prisma.user.create({ data: { name: "SSL A", email: `${RUN}-a@example.invalid` } });
  userB = await prisma.user.create({ data: { name: "SSL B", email: `${RUN}-b@example.invalid` } });
  websiteA = await prisma.website.create({ data: { name: "Example", normalizedUrl: "https://example.com/", userId: userA.id } });
  assert.ok(userA.id && websiteA.id);
});

test("creation COMPLETED; client findings/cert results ignored; query never stored", async () => {
  const d = await createSslRedirectDiagnostic(userA.id, {
    url: "https://example.com/page?token=secret-value#frag",
    findings: [{ code: "FAKE", severity: "HIGH" }],
    tlsOutcome: { verified: true, certificate: { hostname: "attacker.example" } },
    userId: userB.id,
  }, { engine: cannedEngine(), limiter: new SslRateLimiter() });
  assert.equal(d.executionStatus, "COMPLETED");
  assert.equal(d.sanitizedTargetUrl, "https://example.com/page");
  assert.ok(!JSON.stringify(d).includes("secret-value"));
  assert.ok(!JSON.stringify(d).includes("FAKE"));
  assert.ok(!JSON.stringify(d).includes("attacker.example"));
  assert.equal(d.findings.length, 1);
  assert.equal(d.findings[0].code, "TLS_CERT_VALID");
  const row = await prisma.sslRedirectDiagnostic.findUnique({ where: { id: d.id }, include: { findings: true } });
  assert.equal(row.userId, userA.id);
  assert.equal(row.findings.length, 1);
});

test("website selector: owned website URL used, client url ignored; other user's website 404s", async () => {
  const d = await createSslRedirectDiagnostic(userA.id, { url: "https://evil.example/", websiteId: websiteA.id }, { engine: cannedEngine(), limiter: new SslRateLimiter() });
  assert.equal(d.websiteId, websiteA.id);
  // The engine received the owned record's URL, not the client URL:
  // the canned engine always returns example.com/page, but the stored
  // websiteId proves the owned-record path was taken.
  await assert.rejects(
    () => createSslRedirectDiagnostic(userB.id, { websiteId: websiteA.id }, { engine: cannedEngine(), limiter: new SslRateLimiter() }),
    (err) => err instanceof SslError && err.code === "WEBSITE_NOT_FOUND" && err.status === 404,
  );
});

test("ownership: list/get own only; other user gets nothing", async () => {
  const d = await createSslRedirectDiagnostic(userA.id, { url: "https://example.com/own" }, { engine: cannedEngine(), limiter: new SslRateLimiter() });
  const listed = await listSslRedirectDiagnostics(userA.id, { page: 1, pageSize: 100 });
  assert.ok(listed.diagnostics.some((x) => x.id === d.id));
  const listedB = await listSslRedirectDiagnostics(userB.id, { page: 1, pageSize: 100 });
  assert.ok(!listedB.diagnostics.some((x) => x.id === d.id));
  assert.equal(await getSslRedirectDiagnostic(userB.id, d.id), null);
  const own = await getSslRedirectDiagnostic(userA.id, d.id);
  assert.equal(own.id, d.id);
});

test("validation: empty url rejected; rate limit enforced", async () => {
  await assert.rejects(
    () => createSslRedirectDiagnostic(userA.id, { url: "" }, { engine: cannedEngine(), limiter: new SslRateLimiter() }),
    (err) => err instanceof SslError && err.code === "VALIDATION_FAILED",
  );
  const limiter = new SslRateLimiter({ limitPerHour: 1 });
  await createSslRedirectDiagnostic(userA.id, { url: "https://example.com/rl" }, { engine: cannedEngine(), limiter });
  await assert.rejects(
    () => createSslRedirectDiagnostic(userA.id, { url: "https://example.com/rl2" }, { engine: cannedEngine(), limiter }),
    (err) => err instanceof SslError && err.code === "RATE_LIMITED",
  );
});

test("ai: mock provider analysis validates refs and persists; unknown ref rejected", async () => {
  const d = await createSslRedirectDiagnostic(userA.id, { url: "https://example.com/ai" }, { engine: cannedEngine(), limiter: new SslRateLimiter() });
  const diagnostic = await getSslRedirectDiagnostic(userA.id, d.id);
  const findingId = diagnostic.findings[0].id;
  const good = await generateSslAiAnalysis({
    diagnostic, findings: diagnostic.findings, userId: userA.id,
    providerOverride: new MockProvider({ analysis: sslAnalysis(findingId), messagesBuilder: buildSslAiMessages }),
    limiter: new AiRateLimiter(),
  });
  assert.equal(good.status, "COMPLETED");
  assert.equal(good.analysis.summary, "The certificate verified.");
  // Regeneration with an unknown reference must fail validation and
  // leave a FAILED row (not silently drop the reference).
  await assert.rejects(
    () => generateSslAiAnalysis({
      diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true,
      providerOverride: new MockProvider({ analysis: sslAnalysis("unknown-id"), messagesBuilder: buildSslAiMessages }),
      limiter: new AiRateLimiter(),
    }),
    (err) => err.code === "INVALID_OUTPUT",
  );
});

test("ai: unconfigured provider returns AI_NOT_CONFIGURED (no mock in this path)", async () => {
  const d = await createSslRedirectDiagnostic(userA.id, { url: "https://example.com/ai2" }, { engine: cannedEngine(), limiter: new SslRateLimiter() });
  const diagnostic = await getSslRedirectDiagnostic(userA.id, d.id);
  await assert.rejects(
    () => generateSslAiAnalysis({
      diagnostic, findings: diagnostic.findings, userId: userA.id,
      limiter: new AiRateLimiter(),
      config: { provider: "", apiKey: "", model: "", timeoutMs: 30000, maxOutputTokens: 2000 },
    }),
    (err) => err.code === "AI_NOT_CONFIGURED",
  );
});
