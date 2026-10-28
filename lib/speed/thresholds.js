// Core Web Vitals classification (Milestone 9, Tool 05).
// Bands exactly as briefed, matching official Core Web Vitals guidance:
//   LCP: good <= 2500 ms, needs-improvement <= 4000 ms, else poor.
//   INP: good < 200 ms, needs-improvement <= 500 ms, else poor.
//   CLS: good < 0.1, needs-improvement <= 0.25, else poor.
// Field classification uses the CrUX 75th percentile (p75) for the form
// factor; lab classification uses the Lighthouse numeric value and MUST be
// labelled LAB. A missing value classifies as UNAVAILABLE, never as a
// number and never as GOOD. TBT is a lab-only metric: it is classified
// here with Lighthouse-style advisory bands (good <= 200 ms,
// needs-improvement <= 600 ms, else poor) and is NEVER labelled INP.
export const CLASSIFICATIONS = Object.freeze([
  "GOOD",
  "NEEDS_IMPROVEMENT",
  "POOR",
  "UNAVAILABLE",
]);

function isValidNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

export function classifyLcp(ms) {
  if (!isValidNumber(ms)) return "UNAVAILABLE";
  if (ms <= 2500) return "GOOD";
  if (ms <= 4000) return "NEEDS_IMPROVEMENT";
  return "POOR";
}

export function classifyInp(ms) {
  if (!isValidNumber(ms)) return "UNAVAILABLE";
  if (ms < 200) return "GOOD";
  if (ms <= 500) return "NEEDS_IMPROVEMENT";
  return "POOR";
}

export function classifyCls(value) {
  if (!isValidNumber(value)) return "UNAVAILABLE";
  if (value < 0.1) return "GOOD";
  if (value <= 0.25) return "NEEDS_IMPROVEMENT";
  return "POOR";
}

// Lab-only advisory bands for Total Blocking Time. NOT a Core Web Vital
// and NOT an INP substitute; callers must label the result LAB / TBT.
export function classifyTbt(ms) {
  if (!isValidNumber(ms)) return "UNAVAILABLE";
  if (ms <= 200) return "GOOD";
  if (ms <= 600) return "NEEDS_IMPROVEMENT";
  return "POOR";
}

export function classifyMetric(metric, value) {
  if (metric === "lcp") return classifyLcp(value);
  if (metric === "inp") return classifyInp(value);
  if (metric === "cls") return classifyCls(value);
  if (metric === "tbt") return classifyTbt(value);
  return "UNAVAILABLE";
}

// WP Doctor heuristic only (NOT a Google threshold): the basic HTTP
// preflight measures TOTAL response time (scanner durationMs, redirects
// included), not time-to-first-byte. Flag slow totals for investigation.
export function httpElapsedSeverity(elapsedMs) {
  if (!isValidNumber(elapsedMs)) return null;
  if (elapsedMs > 3000) return "HIGH";
  if (elapsedMs > 1000) return "MEDIUM";
  return null;
}
