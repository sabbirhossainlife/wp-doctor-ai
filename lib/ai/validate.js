// Evidence-reference + claim validation for AI output (Milestone 4).
// Runs AFTER shape validation. Any failure rejects the WHOLE analysis as
// INVALID_OUTPUT — references are never silently dropped, because a dropped
// reference would change what the user reads without any trace.
// Claim checks are heuristic guardrails, not a proof of grounding: they catch
// the specific fabrications the scanner's evidence cannot support (TLS detail,
// named-plugin causes, dangerous actions). They do not prove the model never
// hallucinates elsewhere; the UI labels AI output as interpretation for
// exactly that reason.

import { validateAiAnalysisShape } from "./schema.js";

export class AiValidationError extends Error {
  constructor(errors) {
    super("AI output failed validation.");
    this.name = "AiValidationError";
    this.code = "INVALID_OUTPUT";
    this.errors = errors;
  }
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
// A named plugin presented as THE confirmed cause. (Hypotheses that merely
// suggest checking a plugin are not matched: they lack "is the cause".)
const PLUGIN_CAUSE_CLAIM = /plugin\s+["']?[A-Za-z][\w-]*["']?\s+is\s+(the\s+)?(confirmed\s+)?cause/i;

const DANGEROUS_ACTION = [
  /rm\s+-rf\b/i,
  /drop\s+table\b/i,
  /delete\s+(all|every)\s+files/i,
  /disable\s+(your\s+)?security\s+(plugin|plugins)\s+permanently/i,
  /share\s+(your\s+)?(password|api\s+key|secret)/i,
  /expose\s+(your\s+)?(credentials|password|api\s+key)/i,
  /edit\s+(the\s+)?live\s+database\s+directly/i,
  /run\s+.*\s+without\s+review/i,
];

// Throws AiValidationError on any problem; returns the analysis unchanged.
export function validateAnalysis(analysis, findingIds) {
  const errors = [];
  const { errors: shapeErrors } = validateAiAnalysisShape(analysis);
  errors.push(...shapeErrors);
  if (errors.length) throw new AiValidationError(errors);

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

  // Claim guardrails: the scanner never collects TLS detail, so ANY TLS
  // validity claim is unsupported by construction.
  const texts = collectTexts(analysis);
  for (const text of texts) {
    if (TLS_CLAIM.test(text) || TLS_CLAIM_2.test(text)) {
      errors.push("Analysis claims TLS certificate validity, but the scanner collects no TLS detail");
      break;
    }
  }
  for (const text of texts) {
    if (PLUGIN_CAUSE_CLAIM.test(text)) {
      errors.push("Analysis names a plugin as the confirmed cause, but no plugin data was collected");
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
  if (errors.length) throw new AiValidationError(errors);
  return analysis;
}
