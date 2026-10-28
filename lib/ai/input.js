// Minimized, sanitized diagnostic input for the AI provider (Milestone 4).
// Built ONLY from stored Scan + ScanFinding fields. Nothing else is sent:
// no user id, email, passwords, cookies, tokens, API keys, auth headers,
// credentials, raw bodies, internal IPs, personal data, query strings,
// fragments, database connection info, or stack traces. Stored targets are
// already redacted (protocol + hostname + path) by Milestone 3.

export const AI_INPUT_LIMITS = Object.freeze({
  maxTotalChars: 8000,
  findingTitleMax: 300,
  findingDescriptionMax: 1000,
  recommendationMax: 500,
  maxEvidenceHops: 10,
});

function cap(value, max) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

function summarizeEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return null;
  const summary = {};
  if (Array.isArray(evidence.chain)) {
    summary.chain = evidence.chain.slice(0, AI_INPUT_LIMITS.maxEvidenceHops).map((hop) => ({
      status: hop?.status ?? null,
      protocol: hop?.protocol ?? null,
      contentType: hop?.contentType ?? null,
      bodyBytes: hop?.bodyBytes ?? null,
    }));
  }
  if (typeof evidence.errorCode === "string") summary.errorCode = evidence.errorCode;
  if (typeof evidence.redirectCount === "number") summary.redirectCount = evidence.redirectCount;
  return Object.keys(summary).length ? summary : null;
}

export function buildAiInput(scan, findings = []) {
  const L = AI_INPUT_LIMITS;
  const input = {
    executionStatus: scan.executionStatus,
    diagnosticOutcome: scan.diagnosticOutcome,
    httpStatus: scan.httpStatus ?? null,
    durationMs: scan.durationMs ?? null,
    redirectCount: scan.redirectCount ?? null,
    errorCode: scan.errorCode ?? null,
    // Already redacted by Milestone 3: protocol + hostname + path only.
    targetUrl: scan.targetUrl,
    finalUrl: scan.finalUrl ?? null,
    findings: findings.map((f) => ({
      id: f.id,
      title: cap(f.title, L.findingTitleMax),
      description: cap(f.description, L.findingDescriptionMax),
      severity: f.severity,
      status: f.status,
      recommendation: cap(f.recommendation, L.recommendationMax),
      evidenceSummary: summarizeEvidence(f.evidence),
    })),
    unavailableChecks: [
      "TLS certificate detail: not collected by the scanner",
      "WordPress plugin/theme data: requires a future authorized connector",
      "Response body content: not retained by the scanner",
      "Server logs and database state: not observable from a public URL",
    ],
    evidenceNote:
      "The findings above are the complete evidence. Do not assume any other test was performed.",
  };
  // Enforce the total-size cap: shrink descriptions first, then drop evidence
  // summaries, so a pathological finding cannot bloat the prompt.
  let json = JSON.stringify(input);
  if (json.length > L.maxTotalChars) {
    input.findings = input.findings.map((f) => ({
      ...f,
      description: f.description ? f.description.slice(0, 300) : f.description,
    }));
    json = JSON.stringify(input);
  }
  if (json.length > L.maxTotalChars) {
    input.findings = input.findings.map((f) => ({ ...f, evidenceSummary: null }));
    json = JSON.stringify(input);
  }
  if (json.length > L.maxTotalChars) {
    input.findings = input.findings.slice(0, 10);
  }
  return input;
}
