// Evidence-reference + claim validation for Tool 07 AI output.
// Shape mirrors the Tool 06 validator, but schemaVersion is
// "contact-email-1" (NOT "ssl-1" or any earlier version): earlier
// validators are untouched and NOT reused here. Any failure rejects the
// WHOLE analysis as INVALID_OUTPUT — references are never silently
// dropped. Claim checks are heuristic guardrails, not a proof of
// grounding; the UI labels AI output as interpretation.
export const CONTACT_EMAIL_AI_SCHEMA_VERSION = "contact-email-1";

export class ContactEmailAiValidationError extends Error {
  constructor(errors) {
    super(`AI output failed validation: ${errors.join(" | ")}`);
    this.name = "ContactEmailAiValidationError";
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
function checkIdArray(errors, path, value, allowedIds) {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return; }
  if (value.length > 20) errors.push(`${path} exceeds 20 items`);
  const seen = new Set();
  for (const [i, item] of value.entries()) {
    checkString(errors, `${path}[${i}]`, item, 100);
    if (typeof item === "string") {
      if (seen.has(item)) errors.push(`${path}[${i}] duplicates ${item}`);
      seen.add(item);
      if (allowedIds && !allowedIds.includes(item)) errors.push(`${path}[${i}] references unknown finding ${item}`);
    }
  }
}
function checkStringArray(errors, path, value, max = 500) {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return; }
  if (value.length > 20) errors.push(`${path} exceeds 20 items`);
  for (const [i, item] of value.entries()) checkString(errors, `${path}[${i}]`, item, max);
}

// Tool 07-specific forbidden claims: delivery/submission verification,
// DKIM-from-unknown-selector, guaranteed acceptance, automatic DMARC
// enforcement recommendations, and proven-root-cause language.
const BANNED_CLAIMS = [
  [/(email|message) (was )?(sent|delivered|received)/i, "delivery claimed as verified"],
  [/form (was )?submitted/i, "form submission claimed"],
  [/delivery (is )?verified/i, "delivery claimed as verified"],
  [/dkim (is )?missing/i, "DKIM declared missing (selector may be unknown)"],
  [/guarantee[sd]?\b.{0,60}(deliver|inbox|accept)/i, "guaranteed delivery/acceptance claim"],
  [/change (your )?dmarc (policy )?to (quarantine|reject)/i, "automatic DMARC enforcement recommendation"],
  [/root cause (is|proven)/i, "inferred cause presented as proven root cause"],
  [/no forms (exist|on (the|this) site)/i, "absent recognised plugin presented as no forms existing"],
];

function checkBannedClaims(errors, analysis) {
  const texts = [];
  if (typeof analysis.summary === "string") texts.push(analysis.summary);
  if (typeof analysis.explanation === "string") texts.push(analysis.explanation);
  for (const h of analysis.causeHypotheses ?? []) {
    if (isPlainObject(h)) { if (typeof h.title === "string") texts.push(h.title); if (typeof h.explanation === "string") texts.push(h.explanation); }
  }
  for (const a of analysis.recommendedActions ?? []) {
    if (isPlainObject(a)) { if (typeof a.title === "string") texts.push(a.title); if (typeof a.description === "string") texts.push(a.description); }
  }
  const joined = texts.join("\n");
  for (const [pattern, label] of BANNED_CLAIMS) {
    if (pattern.test(joined)) errors.push(`analysis contains a forbidden claim: ${label}`);
  }
}

export function validateContactEmailAnalysisShape(obj) {
  const errors = [];
  if (!isPlainObject(obj)) return { errors: ["analysis must be a JSON object"] };
  noUnknownKeys(errors, "analysis", obj, [
    "schemaVersion", "summary", "explanation", "diagnosticConfidence",
    "confirmedObservations", "causeHypotheses", "recommendedActions",
    "missingEvidence", "limitations", "humanReviewRecommended",
  ]);
  if (obj.schemaVersion !== CONTACT_EMAIL_AI_SCHEMA_VERSION) errors.push(`schemaVersion must be "${CONTACT_EMAIL_AI_SCHEMA_VERSION}"`);
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
      checkString(errors, `${p}.title`, item.title, 300);
      checkString(errors, `${p}.explanation`, item.explanation, 1000);
      checkEnum(errors, `${p}.confidence`, item.confidence, CONFIDENCE);
      checkString(errors, `${p}.additionalEvidenceRequired`, item.additionalEvidenceRequired, 500);
    }
  }
  if (!Array.isArray(obj.recommendedActions)) errors.push("recommendedActions must be an array");
  else {
    if (obj.recommendedActions.length > 20) errors.push("recommendedActions exceeds 20 items");
    for (const [i, item] of obj.recommendedActions.entries()) {
      const p = `recommendedActions[${i}]`;
      if (!isPlainObject(item)) { errors.push(`${p} must be an object`); continue; }
      noUnknownKeys(errors, p, item, ["title", "description", "priority"]);
      checkString(errors, `${p}.title`, item.title, 300);
      checkString(errors, `${p}.description`, item.description, 1000);
      checkEnum(errors, `${p}.priority`, item.priority, PRIORITY);
    }
  }
  checkStringArray(errors, "missingEvidence", obj.missingEvidence);
  checkStringArray(errors, "limitations", obj.limitations);
  return { errors };
}

export function validateContactEmailAnalysis(analysis, findingIds = []) {
  const { errors } = validateContactEmailAnalysisShape(analysis);
  if (errors.length === 0) {
    for (const [i, item] of analysis.confirmedObservations.entries()) {
      if (!findingIds.includes(item.findingId)) errors.push(`confirmedObservations[${i}].findingId references unknown finding ${item.findingId}`);
    }
    for (const [i, item] of analysis.causeHypotheses.entries()) {
      checkIdArray(errors, `causeHypotheses[${i}].supportingFindingIds`, item.supportingFindingIds, findingIds);
    }
    checkBannedClaims(errors, analysis);
  }
  if (errors.length > 0) throw new ContactEmailAiValidationError(errors);
  return analysis;
}
