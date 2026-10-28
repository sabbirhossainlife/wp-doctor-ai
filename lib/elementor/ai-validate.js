// Evidence-reference + claim validation for Tool 04 AI output.
// Shape mirrors the Tool 03 validator, but schemaVersion is
// "elementor-1" (NOT "woocommerce-1" or "conflict-1"): the scan/conflict validators
// are untouched and NOT reused here. Any failure rejects the WHOLE
// analysis as INVALID_OUTPUT — references are never silently dropped.
// Claim checks are heuristic guardrails, not a proof of grounding; the UI
// labels AI output as interpretation.
export const ELEMENTOR_AI_SCHEMA_VERSION = "elementor-1";

export class ElementorAiValidationError extends Error {
  constructor(errors) {
    // Message carries the reasons (also available as .errors) so callers
    // and tests can distinguish WHY an analysis was rejected.
    super(`AI output failed validation: ${errors.join(" | ")}`);
    this.name = "ElementorAiValidationError";
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

export function validateElementorAnalysisShape(obj) {
  const errors = [];
  if (!isPlainObject(obj)) return { errors: ["analysis must be a JSON object"] };
  noUnknownKeys(errors, "analysis", obj, [
    "schemaVersion", "summary", "explanation", "diagnosticConfidence",
    "confirmedObservations", "causeHypotheses", "recommendedActions",
    "missingEvidence", "limitations", "humanReviewRecommended",
  ]);
  if (obj.schemaVersion !== ELEMENTOR_AI_SCHEMA_VERSION) errors.push(`schemaVersion must be "${ELEMENTOR_AI_SCHEMA_VERSION}"`);
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

// Claims with no evidence in this tool: no console data, no rendering,
// no screenshot analysis, no isolation test, no logs are collected.
const INVENTED_JS_CLAIM = /\b(console|javascript|js)\s+(shows?|error|errors|reported|revealed|confirmed)\b/i;
const INVENTED_CSS_CLAIM = /\b(css|stylesheet)\s+(error|failed|broken|confirmed)\b/i;
const VISUAL_VERIFIED_CLAIM = /\b(visually|layout)\s+(verified|confirmed|correct|looks\s+correct)\b/i;
const RENDERED_CLAIM = /\b(rendered|rendering)\s+(test|checked|verified|passed)\b/i;
const SCREENSHOT_CLAIM = /\bscreenshot\s+(shows?|proves?|confirms?|reveals?)\b/i;
const SAFE_MODE_FIXED_CLAIM = /\bsafe\s+mode\s+(fixed|resolved|repairs?)\b/i;
const SAFE_MODE_GUARANTEE_CLAIM = /\bsafe\s+mode\s+(will|guarantees?|always)\s+(fix|resolve|work)\b/i;
const MEMORY_EXHAUSTION_CLAIM = /\bmemory\s+(exhaustion|exhausted)\s+(confirmed|proven|caused)\b/i;
const PLUGIN_CAUSE_CLAIM = /\bplugin\s+["']?[A-Za-z][\w-]*["']?\s+is\s+(the\s+)?(confirmed\s+)?cause\b/i;
const CONFIRMED_CAUSE_CLAIM = /\b(confirmed|proven)\s+cause\b/i;
const UPDATE_CAUSE_CLAIM = /\b(update|upgrade)\s+(caused|is\s+the\s+cause\s+of)\b/i;
const DANGEROUS_ACTION = [
  /rm\s+-rf\b/i,
  /drop\s+table\b/i,
  /delete\s+(all|every)\s+files/i,
  /share\s+(your\s+)?(password|api\s+key|secret)/i,
  /expose\s+(your\s+)?(credentials|password|api\s+key)/i,
  /edit\s+(the\s+)?live\s+database\s+directly/i,
  /run\s+.*\s+without\s+review/i,
  /\bpermanently\s+deactivate\b/i,
  /\bdeactivate\s+.*\s+on\s+(the\s+)?live\s+site/i,
  /\bswitch\s+(the\s+)?theme\s+.*\s+on\s+(the\s+)?live\s+site/i,
  /\boverwrite\s+.*production\s+database/i,
  /\bdelete\s+unknown\s+files/i,
];

export function validateElementorAnalysis(analysis, findingIds) {
  const errors = [];
  const { errors: shapeErrors } = validateElementorAnalysisShape(analysis);
  errors.push(...shapeErrors);
  if (errors.length) throw new ElementorAiValidationError(errors);

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
  const claimChecks = [
    [INVENTED_JS_CLAIM, "Analysis claims a console/JavaScript error, but no console data is collected"],
    [INVENTED_CSS_CLAIM, "Analysis claims a CSS error, but no CSS error data is collected"],
    [VISUAL_VERIFIED_CLAIM, "Analysis claims visual verification, but no visual test was performed"],
    [RENDERED_CLAIM, "Analysis claims a rendering test, but no rendering test was performed"],
    [SCREENSHOT_CLAIM, "Analysis claims screenshot evidence, but no screenshot was collected or analysed"],
    [SAFE_MODE_FIXED_CLAIM, "Analysis claims Safe Mode fixed something, but Safe Mode results were never observed"],
    [SAFE_MODE_GUARANTEE_CLAIM, "Analysis presents Safe Mode as a guaranteed fix, which it is not"],
    [MEMORY_EXHAUSTION_CLAIM, "Analysis claims confirmed memory exhaustion, but only a configured limit is known"],
    [PLUGIN_CAUSE_CLAIM, "Analysis names a plugin as the confirmed cause, but no isolation test was performed"],
    [CONFIRMED_CAUSE_CLAIM, "Analysis claims a confirmed cause, but the deterministic engine makes no such claim"],
    [UPDATE_CAUSE_CLAIM, "Analysis claims an update caused the symptom, but post-update timing is not causation"],
  ];
  for (const [pattern, message] of claimChecks) {
    if (texts.some((t) => pattern.test(t))) errors.push(message);
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
  if (errors.length) throw new ElementorAiValidationError(errors);
  return analysis;
}
