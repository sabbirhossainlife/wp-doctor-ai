// Strict shape validation for AI analysis output (Milestone 4).
// Hand-written on purpose: no new dependency. This validates STRUCTURE only;
// evidence-reference and claim checks live in validate.js. Invalid output is
// rejected, never silently normalized into a success, except that unknown
// fields are an error (not stripped) so a drifting provider cannot smuggle
// new semantics past the UI.

export const AI_SCHEMA_VERSION = "1";

const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"];
const PRIORITY = ["LOW", "MEDIUM", "HIGH"];
const RISK = ["LOW", "MEDIUM", "HIGH"];

export const AI_LIMITS = Object.freeze({
  summaryMax: 1000,
  explanationMax: 4000,
  observationMax: 500,
  hypothesisTitleMax: 200,
  hypothesisExplanationMax: 1000,
  evidenceRequiredMax: 1000,
  actionTitleMax: 200,
  actionExplanationMax: 1000,
  stepMax: 500,
  skillMax: 100,
  stringItemMax: 500,
  maxObservations: 20,
  maxHypotheses: 10,
  maxActions: 15,
  maxStepsPerAction: 20,
  maxRefsPerItem: 20,
  maxStringItems: 20,
});

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkString(errors, path, value, { min = 1, max }) {
  if (typeof value !== "string") errors.push(`${path} must be a string`);
  else if (value.length < min) errors.push(`${path} must not be empty`);
  else if (value.length > max) errors.push(`${path} exceeds ${max} characters`);
}

function checkEnum(errors, path, value, allowed) {
  if (!allowed.includes(value)) errors.push(`${path} must be one of ${allowed.join(", ")}`);
}

function checkStringArray(errors, path, value, maxItems, maxLen) {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return; }
  if (value.length > maxItems) errors.push(`${path} exceeds ${maxItems} items`);
  for (const [i, item] of value.entries()) checkString(errors, `${path}[${i}]`, item, { min: 1, max: maxLen });
}

function checkIdArray(errors, path, value, maxItems) {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return; }
  if (value.length > maxItems) errors.push(`${path} exceeds ${maxItems} items`);
  for (const [i, item] of value.entries()) checkString(errors, `${path}[${i}]`, item, { min: 1, max: 100 });
}

function noUnknownKeys(errors, path, obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not a supported field`);
  }
}

// Returns { errors: string[] }. Empty errors = structurally valid.
export function validateAiAnalysisShape(obj) {
  const errors = [];
  const L = AI_LIMITS;
  if (!isPlainObject(obj)) return { errors: ["analysis must be a JSON object"] };
  noUnknownKeys(errors, "analysis", obj, [
    "schemaVersion", "summary", "explanation", "diagnosticConfidence",
    "confirmedObservations", "causeHypotheses", "recommendedActions",
    "missingEvidence", "limitations", "humanReviewRecommended",
  ]);
  if (obj.schemaVersion !== AI_SCHEMA_VERSION) errors.push(`schemaVersion must be "${AI_SCHEMA_VERSION}"`);
  checkString(errors, "summary", obj.summary, { min: 1, max: L.summaryMax });
  checkString(errors, "explanation", obj.explanation, { min: 1, max: L.explanationMax });
  checkEnum(errors, "diagnosticConfidence", obj.diagnosticConfidence, CONFIDENCE);
  if (typeof obj.humanReviewRecommended !== "boolean") errors.push("humanReviewRecommended must be a boolean");

  if (!Array.isArray(obj.confirmedObservations)) errors.push("confirmedObservations must be an array");
  else {
    if (obj.confirmedObservations.length > L.maxObservations) errors.push("confirmedObservations exceeds 20 items");
    for (const [i, item] of obj.confirmedObservations.entries()) {
      const p = `confirmedObservations[${i}]`;
      if (!isPlainObject(item)) { errors.push(`${p} must be an object`); continue; }
      noUnknownKeys(errors, p, item, ["findingId", "observation"]);
      checkString(errors, `${p}.findingId`, item.findingId, { min: 1, max: 100 });
      checkString(errors, `${p}.observation`, item.observation, { min: 1, max: L.observationMax });
    }
  }

  if (!Array.isArray(obj.causeHypotheses)) errors.push("causeHypotheses must be an array");
  else {
    if (obj.causeHypotheses.length > L.maxHypotheses) errors.push("causeHypotheses exceeds 10 items");
    for (const [i, item] of obj.causeHypotheses.entries()) {
      const p = `causeHypotheses[${i}]`;
      if (!isPlainObject(item)) { errors.push(`${p} must be an object`); continue; }
      noUnknownKeys(errors, p, item, ["title", "explanation", "confidence", "supportingFindingIds", "additionalEvidenceRequired"]);
      checkString(errors, `${p}.title`, item.title, { min: 1, max: L.hypothesisTitleMax });
      checkString(errors, `${p}.explanation`, item.explanation, { min: 1, max: L.hypothesisExplanationMax });
      checkEnum(errors, `${p}.confidence`, item.confidence, CONFIDENCE);
      checkIdArray(errors, `${p}.supportingFindingIds`, item.supportingFindingIds, L.maxRefsPerItem);
      checkString(errors, `${p}.additionalEvidenceRequired`, item.additionalEvidenceRequired, { min: 1, max: L.evidenceRequiredMax });
    }
  }

  if (!Array.isArray(obj.recommendedActions)) errors.push("recommendedActions must be an array");
  else {
    if (obj.recommendedActions.length > L.maxActions) errors.push("recommendedActions exceeds 15 items");
    for (const [i, item] of obj.recommendedActions.entries()) {
      const p = `recommendedActions[${i}]`;
      if (!isPlainObject(item)) { errors.push(`${p} must be an object`); continue; }
      noUnknownKeys(errors, p, item, ["title", "explanation", "priority", "riskLevel", "skillLevel", "steps", "referencedFindingIds", "humanReviewRecommended"]);
      checkString(errors, `${p}.title`, item.title, { min: 1, max: L.actionTitleMax });
      checkString(errors, `${p}.explanation`, item.explanation, { min: 1, max: L.actionExplanationMax });
      checkEnum(errors, `${p}.priority`, item.priority, PRIORITY);
      checkEnum(errors, `${p}.riskLevel`, item.riskLevel, RISK);
      checkString(errors, `${p}.skillLevel`, item.skillLevel, { min: 1, max: L.skillMax });
      if (!Array.isArray(item.steps)) errors.push(`${p}.steps must be an array`);
      else {
        if (item.steps.length < 1) errors.push(`${p}.steps must not be empty`);
        if (item.steps.length > L.maxStepsPerAction) errors.push(`${p}.steps exceeds 20 items`);
        for (const [j, step] of item.steps.entries()) checkString(errors, `${p}.steps[${j}]`, step, { min: 1, max: L.stepMax });
      }
      checkIdArray(errors, `${p}.referencedFindingIds`, item.referencedFindingIds, L.maxRefsPerItem);
      if (typeof item.humanReviewRecommended !== "boolean") errors.push(`${p}.humanReviewRecommended must be a boolean`);
    }
  }

  checkStringArray(errors, "missingEvidence", obj.missingEvidence, L.maxStringItems, L.stringItemMax);
  checkStringArray(errors, "limitations", obj.limitations, L.maxStringItems, L.stringItemMax);
  return { errors };
}
