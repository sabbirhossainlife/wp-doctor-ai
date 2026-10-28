// Tool 06 AI validation tests (mirror Tool 05's validator tests).
import test from "node:test";
import assert from "node:assert/strict";
import { validateSslAnalysis, validateSslAnalysisShape, SSL_AI_SCHEMA_VERSION } from "../lib/ssl/ai-validate.js";
import { buildSslAiInput } from "../lib/ssl/ai-input.js";

function validAnalysis(findingId) {
  return {
    schemaVersion: SSL_AI_SCHEMA_VERSION,
    summary: "The certificate verified and the chain completed.",
    explanation: "The deterministic report shows a verified certificate and a completed redirect chain.",
    diagnosticConfidence: "HIGH",
    confirmedObservations: [{ findingId, observation: "The certificate verified." }],
    causeHypotheses: [],
    recommendedActions: [{ title: "Renew before expiry", description: "Renew the certificate before its expiry date.", priority: "LOW" }],
    missingEvidence: [],
    limitations: ["No header data was collected."],
    humanReviewRecommended: false,
  };
}

test("ssl ai: valid analysis passes; input strips unverified cert fields and query strings", () => {
  const analysis = validAnalysis("f1");
  assert.equal(validateSslAnalysis(analysis, ["f1"]), analysis);
  const diagnostic = {
    sanitizedTargetUrl: "https://example.com/page",
    executionStatus: "COMPLETED",
    tlsOutcome: { scheme: "https", verified: false, errorCode: "TLS_CERT_EXPIRED", certificate: { hostname: "example.com", validFrom: "2020-01-01T00:00:00.000Z", validTo: "2021-01-01T00:00:00.000Z" }, daysToExpiry: -100 },
    summary: { certStatus: "TLS_CERT_EXPIRED", finalUrl: "https://example.com/page", finalStatus: null, redirectCount: 0, crossHost: false, downgradeBlocked: false, terminalReason: "TLS_FAILURE" },
    redirectChain: [],
    limitations: [],
  };
  const input = buildSslAiInput(diagnostic, [{ id: "f1", code: "TLS_CERT_EXPIRED", severity: "HIGH", title: "Expired", explanation: "Expired cert.", evidence: {}, recommendation: "Replace.", confidence: "HIGH" }]);
  assert.equal(input.tls.validFrom, null, "unverified cert dates must not reach AI input");
  assert.equal(input.tls.validTo, null);
  assert.equal(input.tls.errorCode, "TLS_CERT_EXPIRED");
  assert.ok(!JSON.stringify(input).includes("?token"));
});

test("ssl ai: unknown finding reference rejected", () => {
  const analysis = validAnalysis("nope");
  assert.throws(() => validateSslAnalysis(analysis, ["f1"]), /unknown finding/);
});

test("ssl ai: wrong schema version rejected", () => {
  const analysis = validAnalysis("f1");
  analysis.schemaVersion = "speed-1";
  const { errors } = validateSslAnalysisShape(analysis);
  assert.ok(errors.some((e) => e.includes("ssl-1")));
});

test("ssl ai: cross-host redirect presented as malicious is banned", () => {
  const analysis = validAnalysis("f1");
  analysis.explanation = "The cross-host redirect is malicious and proves the site was hijacked.";
  assert.throws(() => validateSslAnalysis(analysis, ["f1"]), /forbidden claim/);
});

test("ssl ai: guaranteed security claim is banned", () => {
  const analysis = validAnalysis("f1");
  analysis.summary = "This guarantees your site is secure forever.";
  assert.throws(() => validateSslAnalysis(analysis, ["f1"]), /forbidden claim/);
});
