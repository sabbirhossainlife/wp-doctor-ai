// Tool 08 AI validation tests (Milestone 12).
import test from "node:test";
import assert from "node:assert/strict";
import { validateSecurityAnalysis, SECURITY_AI_SCHEMA_VERSION } from "../lib/security/ai-validate.js";

function validAnalysis(overrides = {}) {
  return {
    schemaVersion: SECURITY_AI_SCHEMA_VERSION,
    summary: "Matched advisories are potential issues only.",
    explanation: "The deterministic report shows one matched advisory and several hardening gaps.",
    diagnosticConfidence: "HIGH",
    confirmedObservations: [],
    causeHypotheses: [],
    recommendedActions: [],
    missingEvidence: [],
    limitations: [],
    humanReviewRecommended: false,
    ...overrides,
  };
}

test("valid analysis passes; unknown finding refs rejected", () => {
  const ok = validateSecurityAnalysis(validAnalysis({ confirmedObservations: [{ findingId: "f1", observation: "Matched advisory." }] }), ["f1"]);
  assert.equal(ok.schemaVersion, SECURITY_AI_SCHEMA_VERSION);
  assert.throws(() => validateSecurityAnalysis(validAnalysis({ confirmedObservations: [{ findingId: "nope", observation: "x" }] }), ["f1"]), /unknown finding/);
});

test("forbidden claims rejected: 100% secure, no vulnerabilities, proven exploitation, auto XML-RPC disable", () => {
  for (const summary of [
    "The site is 100% secure.",
    "There are no vulnerabilities on this site.",
    "The vulnerability was exploited successfully.",
    "You should disable XML-RPC now.",
  ]) {
    assert.throws(() => validateSecurityAnalysis(validAnalysis({ summary }), []), /forbidden claim/, summary);
  }
});

test("wrong schema version and unknown keys rejected", () => {
  assert.throws(() => validateSecurityAnalysis(validAnalysis({ schemaVersion: "contact-email-1" }), []));
  assert.throws(() => validateSecurityAnalysis(validAnalysis({ extra: 1 }), []));
});
