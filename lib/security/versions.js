// Tool 08 version + range matching (Milestone 12). Pure, no I/O.
// Reuses the M6 comparator for STANDARD versions only. Conservative by
// design: any installed version that is not a plain dotted numeric version
// (prerelease, dev, unknown, nonstandard) is COMPONENT_VERSION_UNKNOWN —
// it is never matched against an advisory and never declared safe.
// Supported provider range representations (WPVulnerability operator
// objects): min_version/min_operator in {gt, ge}, max_version/
// max_operator in {lt, le, eq}; either bound may be null (open-ended).
// `unfixed` (truthy "1") means no fixed version exists; it does not change
// the match. Any other operator, unparseable bound, or nonstandard
// installed version yields INSUFFICIENT_EVIDENCE for that advisory.
// fixedVersion derivation: ONLY max_operator "lt" (the bound itself is the
// first fixed version). For "le" the fixed version is strictly above the
// bound and is unknown — it is never fabricated. For "eq" there is no
// single fixed version. Core advisories are version-specific (the provider
// endpoint is per-version), so core matching does not use ranges at all.
import { compareVersions } from "../conflict/versions.js";

const STANDARD_VERSION = /^v?\d+(?:\.\d+)*$/;

export function isStandardVersion(value) {
  return typeof value === "string" && STANDARD_VERSION.test(value.trim());
}

function operatorMatches(cmp, operator) {
  if (operator === "lt") return cmp < 0;
  if (operator === "le") return cmp <= 0;
  if (operator === "gt") return cmp > 0;
  if (operator === "ge") return cmp >= 0;
  if (operator === "eq") return cmp === 0;
  return null; // unsupported operator
}

// Returns { matched: boolean } or { insufficient: true, reason }.
// `operator` is the provider's raw operator object (may be null/partial).
export function matchVersionRange(installedVersion, operator) {
  if (!isStandardVersion(installedVersion)) {
    return { insufficient: true, reason: "INSTALLED_VERSION_NOT_STANDARD" };
  }
  if (!operator || typeof operator !== "object") {
    return { insufficient: true, reason: "OPERATOR_MISSING" };
  }
  const { min_version: minVersion, min_operator: minOperator, max_version: maxVersion, max_operator: maxOperator } = operator;
  if (minVersion !== null && minVersion !== undefined) {
    if (!["gt", "ge"].includes(minOperator) || !isStandardVersion(String(minVersion))) {
      return { insufficient: true, reason: "MIN_BOUND_UNSUPPORTED" };
    }
    const cmp = compareVersions(installedVersion, String(minVersion));
    if (cmp === null) return { insufficient: true, reason: "MIN_BOUND_UNPARSEABLE" };
    if (operatorMatches(cmp, minOperator) === false) return { matched: false };
  }
  if (maxVersion !== null && maxVersion !== undefined) {
    if (!["lt", "le", "eq"].includes(maxOperator) || !isStandardVersion(String(maxVersion))) {
      return { insufficient: true, reason: "MAX_BOUND_UNSUPPORTED" };
    }
    const cmp = compareVersions(installedVersion, String(maxVersion));
    if (cmp === null) return { insufficient: true, reason: "MAX_BOUND_UNPARSEABLE" };
    if (operatorMatches(cmp, maxOperator) === false) return { matched: false };
  }
  if (minVersion == null && maxVersion == null) {
    return { insufficient: true, reason: "NO_BOUNDS" };
  }
  return { matched: true };
}

// fixedVersion only where provider semantics support it (see header).
export function deriveFixedVersion(operator) {
  if (!operator || typeof operator !== "object") return null;
  if (String(operator.unfixed) === "1") return null;
  if (operator.max_operator === "lt" && isStandardVersion(String(operator.max_version ?? ""))) {
    return String(operator.max_version);
  }
  return null;
}
