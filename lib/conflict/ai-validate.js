// Evidence-reference + claim validation for Tool 02 AI output.
// Shape mirrors the Milestone 4 scan shape, but schemaVersion is
// "conflict-1" (NOT "1"): scan validation is untouched and NOT reused
// here, because its schemaVersion check would reject conflict output.
// Any failure rejects the WHOLE analysis as INVALID_OUTPUT — references
// are never silently dropped. Claim checks are heuristic guardrails, not
// a proof of grounding; the UI labels AI output as interpretation.

export const CONFLICT_AI_SCHEMA_VERSION = "conflict-1";

export class ConflictAiValidationError extends Error {
  constructor(errors) {
    super("AI output failed validation.");
    this.name = "ConflictAiValidationError";
    this.code = "INVALID_OUTPUT";
    this.errors = errors;
  }
}

const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"];
const PRIORITY = ["LOW", "MEDIUM", "HIGH"];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkString(errors, path, value, max) {
  if (typeof value !== "string") errors.push(`${path} must be a string`);
  else if (value.length < 1) errors.push(`${path} must not be empty`);
  else if (value.length > max) errors.push(`${path} exceeds ${max} characters`);
}

function checkEnum(errors, path, value, allowed) {
  if (!allowed.includes(value)) errors.push(`${path} must be one of ${allowed.join(", ")}`);
}

function noUnknownKeys(errors, path, obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not a supported field`);
  }
}

function checkIdArray(errors, path, value) {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return; }
  if (value.length > 20) errors.push(`${path} exceeds 20 items`);
  for (const [i, item] of value.entries()) checkString(errors, `${path}[${i}]`, item, 100);
}

function checkStringArray(errors, path, value) {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return; }
  if (value.length > 20) errors.push(`${path} exceeds 20 items`);
  for (const [i, item] of value.entries()) checkString(errors, `${path}[${i}]`, item, 500);
}

export function validateConflictAnalysisShape(obj) {
  const errors = [];
  if (!isPlainObject(obj)) return { errors: ["analysis must be a JSON object"] };
  noUnknownKeys(errors, "analysis", obj, [
    "schemaVersion", "summary", "explanation", "diagnosticConfidence",
    "confirmedObservations", "causeHypotheses", "recommendedActions",
    "missingEvidence", "limitations", "humanReviewRecommended",
  ]);
  if (obj.schemaVersion !== CONFLICT_AI_SCHEMA_VERSION) errors.push(`schemaVersion must be "${CONFLICT_AI_SCHEMA_VERSION}"`);
  checkString(errors, "summary", obj.summary, 1000);
  checkString(errors, "explanation", obj.explanation, 4000);
  checkEnum(errors, "diagnosticConfidence", obj.diagnosticConfidence, CONFIDENCE);
  if (typeof obj.humanReviewRecommended !== "boolean") errors.push("humanReviewRecommended must be a boolean");
  if (!Array.isArray(obj.confirmedObservations)) errors.push("confirmedObservations must be an array");
  else {
    if (obj.confirmedObservations.length > 20) errors.push("confirmedObservations exceeds 20 items");
    for (const [i, item] of obj.confirmedObservations.entries()) {
      const p = `confirmedObservations[${i}]`;
      if (!isPlainObject(item)) { errors.push(`${p} must be an object`); continue; }
      noUnknownKeys(errors, p, item, ["findingId", "observation"]);
      checkString(errors, `${p}.findingId`, item.findingId, 100);
      checkString(errors, `${p}.observation`, item.observation, 500);
    }
  }
  if (!Array.isArray(obj.causeHypotheses)) errors.push("causeHypotheses must be an array");
  else {
    if (obj.causeHypotheses.length > 10) errors.push("causeHypotheses exceeds 10 items");
    for (const [i, item] of obj.causeHypotheses.entries()) {
      const p = `causeHypotheses[${i}]`;
      if (!isPlainObject(item)) { errors.push(`${p} must be an object`); continue; }
      noUnknownKeys(errors, p, item, ["title", "explanation", "confidence", "supportingFindingIds", "additionalEvidenceRequired"]);
      checkString(errors, `${p}.title`, item.title, 200);
      checkString(errors, `${p}.explanation`, item.explanation, 1000);
      checkEnum(errors, `${p}.confidence`, item.confidence, CONFIDENCE);
      checkIdArray(errors, `${p}.supportingFindingIds`, item.supportingFindingIds);
      checkString(errors, `${p}.additionalEvidenceRequired`, item.additionalEvidenceRequired, 1000);
    }
  }
  if (!Array.isArray(obj.recommendedActions)) errors.push("recommendedActions must be an array");
  else {
    if (obj.recommendedActions.length > 15) errors.push("recommendedActions exceeds 15 items");
    for (const [i, item] of obj.recommendedActions.entries()) {
      const p = `recommendedActions[${i}]`;
      if (!isPlainObject(item)) { errors.push(`${p} must be an object`); continue; }
      noUnknownKeys(errors, p, item, ["title", "explanation", "priority", "riskLevel", "skillLevel", "steps", "referencedFindingIds", "humanReviewRecommended"]);
      checkString(errors, `${p}.title`, item.title, 200);
      checkString(errors, `${p}.explanation`, item.explanation, 1000);
      checkEnum(errors, `${p}.priority`, item.priority, PRIORITY);
      checkEnum(errors, `${p}.riskLevel`, item.riskLevel, PRIORITY);
      checkString(errors, `${p}.skillLevel`, item.skillLevel, 100);
      if (!Array.isArray(item.steps)) errors.push(`${p}.steps must be an array`);
      else {
        if (item.steps.length < 1) errors.push(`${p}.steps must not be empty`);
        if (item.steps.length > 20) errors.push(`${p}.steps exceeds 20 items`);
        for (const [j, step] of item.steps.entries()) checkString(errors, `${p}.steps[${j}]`, step, 500);
      }
      checkIdArray(errors, `${p}.referencedFindingIds`, item.referencedFindingIds);
      if (typeof item.humanReviewRecommended !== "boolean") errors.push(`${p}.humanReviewRecommended must be a boolean`);
    }
  }
  checkStringArray(errors, "missingEvidence", obj.missingEvidence);
  checkStringArray(errors, "limitations", obj.limitations);
  return { errors };
}

function collectTexts(analysis) {
  const texts = [analysis.summary, analysis.explanation];
  for (const o of analysis.confirmedObservations || []) texts.push(o.observation);
  for (const h of analysis.causeHypotheses || []) texts.push(h.title, h.explanation, h.additionalEvidenceRequired);
  for (const a of analysis.recommendedActions || []) texts.push(a.title, a.explanation, ...(a.steps || []));
  for (const s of [...(analysis.missingEvidence || []), ...(analysis.limitations || [])]) texts.push(s);
  return texts.filter((t) => typeof t === "string");
}

const TLS_CLAIM = /(tls|ssl)\s+(certificate|cert)\s+(is|was)\s+(valid|invalid|expired|trusted|untrusted|ok)/i;
const TLS_CLAIM_2 = /(certificate|cert)\s+(is|was)\s+(valid|invalid|expired)/i;
const PLUGIN_CAUSE_CLAIM = /plugin\s+["']?[A-Za-z][\w-]*["']?\s+is\s+(the\s+)?(confirmed\s+)?cause/i;
const THEME_CAUSE_CLAIM = /theme\s+["']?[A-Za-z][\w-]*["']?\s+is\s+(the\s+)?(confirmed\s+)?cause/i;
// A confirmed conflict between two plugins is unsupported by construction:
// the deterministic engine never makes such a claim.
const CONFIRMED_CONFLICT_CLAIM = /\b(confirmed|proven)\s+conflict\b/i;
const DANGEROUS_ACTION = [
  /rm\s+-rf\b/i,
  /drop\s+table\b/i,
  /delete\s+(all|every)\s+files/i,
  /disable\s+(your\s+)?security\s+(plugin|plugins)\s+permanently/i,
  /share\s+(your\s+)?(password|api\s+key|secret)/i,
  /expose\s+(your\s+)?(credentials|password|api\s+key)/i,
  /edit\s+(the\s+)?live\s+database\s+directly/i,
  /run\s+.*\s+without\s+review/i,
  /deactivate\s+.*\s+on\s+(the\s+)?live\s+site/i,
  /switch\s+(the\s+)?theme\s+on\s+(the\s+)?live\s+site/i,
];

// Throws ConflictAiValidationError on any problem; returns analysis unchanged.
export function validateConflictAnalysis(analysis, findingIds) {
  const errors = [];
  const { errors: shapeErrors } = validateConflictAnalysisShape(analysis);
  errors.push(...shapeErrors);
  if (errors.length) throw new ConflictAiValidationError(errors);

  const known = new Set(findingIds);
  const checkRefs = (path, ids) => {
    const seen = new Set();
    for (const id of ids) {
      if (!known.has(id)) errors.push(`${path} references unknown finding id "${id}"`);
      if (seen.has(id)) errors.push(`${path} repeats finding id "${id}"`);
      seen.add(id);
    }
  };
  for (const [i, o] of analysis.confirmedObservations.entries()) {
    if (!known.has(o.findingId)) errors.push(`confirmedObservations[${i}].findingId references unknown finding id "${o.findingId}"`);
  }
  for (const [i, h] of analysis.causeHypotheses.entries()) checkRefs(`causeHypotheses[${i}].supportingFindingIds`, h.supportingFindingIds);
  for (const [i, a] of analysis.recommendedActions.entries()) checkRefs(`recommendedActions[${i}].referencedFindingIds`, a.referencedFindingIds);

  const texts = collectTexts(analysis);
  for (const text of texts) {
    if (TLS_CLAIM.test(text) || TLS_CLAIM_2.test(text)) {
      errors.push("Analysis claims TLS certificate validity, but no TLS detail is collected");
      break;
    }
  }
  for (const text of texts) {
    if (PLUGIN_CAUSE_CLAIM.test(text) || THEME_CAUSE_CLAIM.test(text)) {
      errors.push("Analysis names a plugin or theme as the confirmed cause, but no plugin/theme data supports a confirmed cause");
      break;
    }
  }
  for (const text of texts) {
    if (CONFIRMED_CONFLICT_CLAIM.test(text)) {
      errors.push("Analysis claims a confirmed conflict, but the deterministic engine makes no such claim");
      break;
    }
  }
  for (const a of analysis.recommendedActions) {
    const joined = [a.title, a.explanation, ...(a.steps || [])].join(" ");
    for (const pattern of DANGEROUS_ACTION) {
      if (pattern.test(joined)) {
        errors.push(`Recommended action "${a.title}" contains a disallowed dangerous instruction`);
        break;
      }
    }
  }
  if (errors.length) throw new ConflictAiValidationError(errors);
  return analysis;
}
