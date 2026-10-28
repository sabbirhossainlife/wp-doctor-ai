// Tool 07 AI validation tests (mirror Tool 06's validator tests).
import test from "node:test";
import assert from "node:assert/strict";
import { validateContactEmailAnalysis, CONTACT_EMAIL_AI_SCHEMA_VERSION } from "../lib/contact-email/ai-validate.js";
import { buildContactEmailAiInput } from "../lib/contact-email/ai-input.js";

function validAnalysis(findingId) {
  return {
    schemaVersion: CONTACT_EMAIL_AI_SCHEMA_VERSION,
    summary: "SPF is missing but DMARC is monitoring only.",
    explanation: "The deterministic report shows no SPF record and a DMARC monitoring policy.",
    diagnosticConfidence: "HIGH",
    confirmedObservations: [{ findingId, observation: "No SPF record was found." }],
    causeHypotheses: [],
    recommendedActions: [{ title: "Add SPF", description: "Publish an SPF record authorising the real senders.", priority: "MEDIUM" }],
    missingEvidence: ["DKIM selector"],
    limitations: ["Delivery was not verified."],
    humanReviewRecommended: false,
  };
}

test("contact-email ai: valid analysis passes; input never carries secrets or full addresses", () => {
  const analysis = validAnalysis("f1");
  assert.equal(validateContactEmailAnalysis(analysis, ["f1"]), analysis);
  const diagnostic = {
    sanitizedTargetUrl: "https://example.com/page",
    sanitizedEmailDomain: "example.com",
    executionStatus: "COMPLETED",
    snapshotSchemaVersion: 5,
    spfObservation: { status: "MISSING", excerpt: ["hello"] },
    dmarcObservation: { status: "PRESENT", policy: "none", excerpt: ["v=DMARC1; p=none"] },
    dkimObservation: { status: "NOT_CHECKED", reason: "SELECTOR_UNKNOWN" },
    summary: { snapshotStatus: "CURRENT", emailDomainSource: "default", spfStatus: "MISSING", dmarcStatus: "PRESENT", dmarcPolicy: "none", dkimStatus: "NOT_CHECKED", dnsFailed: false, senderComparison: { senderConfigured: "unknown", senderDomain: null, domainMatches: null, comparisonEstablished: false } },
  };
  const input = buildContactEmailAiInput(diagnostic, [{ id: "f1", code: "SPF_RECORD_MISSING", severity: "MEDIUM", title: "No SPF", explanation: "Missing.", evidence: {}, recommendation: "Add SPF.", confidence: "HIGH", evidenceStatus: "CONFIRMED" }]);
  assert.equal(input.sanitizedEmailDomain, "example.com");
  assert.ok(!JSON.stringify(input).includes("@example.com"), "no full address may reach AI input");
  assert.ok(!JSON.stringify(input).includes("SENTINEL"));
});

test("contact-email ai: unknown finding reference rejected", () => {
  const analysis = validAnalysis("nope");
  assert.throws(() => validateContactEmailAnalysis(analysis, ["f1"]), /unknown finding/);
});

test("contact-email ai: forbidden claims rejected (delivery, DKIM-missing, guaranteed acceptance, auto DMARC enforcement)", () => {
  const cases = [
    "The email was sent successfully.",
    "DKIM is missing for this domain.",
    "This guarantees delivery to the inbox.",
    "You should change your DMARC policy to reject now.",
    "The root cause is proven to be the missing SPF record.",
    "No forms exist on this site.",
  ];
  for (const text of cases) {
    const analysis = validAnalysis("f1");
    analysis.explanation = text;
    assert.throws(() => validateContactEmailAnalysis(analysis, ["f1"]), /forbidden claim/, text);
  }
});

test("contact-email ai: wrong schema version rejected", () => {
  const analysis = validAnalysis("f1");
  analysis.schemaVersion = "ssl-1";
  assert.throws(() => validateContactEmailAnalysis(analysis, ["f1"]), /contact-email-1/);
});
