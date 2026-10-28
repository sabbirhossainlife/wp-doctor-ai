import test from "node:test";
import assert from "node:assert/strict";
import { validateAiAnalysisShape } from "../lib/ai/schema.js";
import { validAnalysis } from "./ai-fixture.js";

test("valid analysis passes shape validation", () => {
  assert.deepEqual(validateAiAnalysisShape(validAnalysis("f1")).errors, []);
});

test("missing required field is rejected", () => {
  const a = validAnalysis("f1");
  delete a.explanation;
  assert.ok(validateAiAnalysisShape(a).errors.length > 0);
});

test("invalid enum values are rejected", () => {
  const a = validAnalysis("f1");
  a.diagnosticConfidence = "VERY_SURE";
  assert.ok(validateAiAnalysisShape(a).errors.some((e) => e.includes("diagnosticConfidence")));
  const b = validAnalysis("f1");
  b.recommendedActions[0].riskLevel = "CRITICAL";
  assert.ok(validateAiAnalysisShape(b).errors.some((e) => e.includes("riskLevel")));
});

test("oversized strings and arrays are rejected", () => {
  const a = validAnalysis("f1");
  a.summary = "x".repeat(1001);
  assert.ok(validateAiAnalysisShape(a).errors.length > 0);
  const b = validAnalysis("f1");
  b.confirmedObservations = Array.from({ length: 21 }, (_, i) => ({ findingId: "f1", observation: `obs ${i}` }));
  assert.ok(validateAiAnalysisShape(b).errors.length > 0);
  const c = validAnalysis("f1");
  c.recommendedActions[0].steps = [];
  assert.ok(validateAiAnalysisShape(c).errors.length > 0);
});

test("unknown fields are rejected, not stripped", () => {
  const a = validAnalysis("f1");
  a.extraField = "smuggled";
  assert.ok(validateAiAnalysisShape(a).errors.some((e) => e.includes("extraField")));
  const b = validAnalysis("f1");
  b.recommendedActions[0].shellCommand = "rm -rf /";
  assert.ok(validateAiAnalysisShape(b).errors.some((e) => e.includes("shellCommand")));
});

test("wrong schema version and non-boolean flags are rejected", () => {
  const a = validAnalysis("f1");
  a.schemaVersion = "2";
  assert.ok(validateAiAnalysisShape(a).errors.length > 0);
  const b = validAnalysis("f1");
  b.humanReviewRecommended = "yes";
  assert.ok(validateAiAnalysisShape(b).errors.length > 0);
});

test("empty analysis is rejected", () => {
  assert.ok(validateAiAnalysisShape({}).errors.length > 0);
  assert.ok(validateAiAnalysisShape(null).errors.length > 0);
});
