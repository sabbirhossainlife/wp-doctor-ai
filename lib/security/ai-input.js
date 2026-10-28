// Minimized, sanitized input for Tool 08 AI interpretation.
// Built ONLY from the stored SecurityDiagnostic + finding rows.
// Sent: sanitized website URL, execution status, snapshot schema version,
// provider statuses (ids + statuses only), component statuses (slug,
// version, status — no full inventory beyond what the report already
// holds), sanitized HTTP observation classifications (header presence,
// sensitive-path results — never bodies), summary counts, and
// deterministic finding IDs/titles/evidence (advisory ids + source URLs
// only, never secrets). Never sent: response bodies, credentials, config,
// user lists, orders, internal IPs, or any client-supplied data.
export const SECURITY_AI_INPUT_LIMITS = Object.freeze({
  maxTotalChars: 8000,
  findingTitleMax: 300,
  findingDescriptionMax: 1000,
  recommendationMax: 500,
});

function cap(value, max) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

export function buildSecurityAiInput(diagnostic, findings = []) {
  const L = SECURITY_AI_INPUT_LIMITS;
  const summary = diagnostic.summary && typeof diagnostic.summary === "object" ? diagnostic.summary : null;
  const providerStatuses = Array.isArray(diagnostic.providerStatuses) ? diagnostic.providerStatuses.map((p) => ({ providerId: p.providerId ?? null, status: p.status ?? null })) : [];
  const http = diagnostic.httpObservations && typeof diagnostic.httpObservations === "object" ? diagnostic.httpObservations : {};
  const input = {
    sanitizedWebsiteUrl: diagnostic.sanitizedWebsiteUrl,
    executionStatus: diagnostic.executionStatus,
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    providerStatuses,
    componentStatuses: summary?.componentStatuses ?? null,
    matchedAdvisoryCount: summary?.matchedAdvisoryCount ?? null,
    httpObservations: {
      homepageStatus: http.homepage?.status ?? null,
      homepageHeadersPresent: http.homepage?.headers ? Object.keys(http.homepage.headers) : [],
      xmlrpcResponds: http.xmlrpc?.responds ?? null,
      sensitivePaths: Array.isArray(http.sensitivePaths) ? http.sensitivePaths.map((p) => ({ path: p.path ?? null, status: p.status ?? null, result: p.result ?? null })) : [],
    },
    limitations: Array.isArray(diagnostic.limitations) ? diagnostic.limitations.slice(0, 10) : [],
    findings: findings.map((f) => ({
      id: f.id,
      code: f.code,
      severity: f.severity,
      title: cap(f.title, L.findingTitleMax),
      explanation: cap(f.explanation, L.findingDescriptionMax),
      evidence: f.evidence ?? {},
      recommendation: cap(f.recommendation, L.recommendationMax),
      confidence: f.confidence ?? null,
      evidenceStatus: f.evidenceStatus ?? null,
      advisoryId: f.advisoryId ?? null,
      cveId: f.cveId ?? null,
    })),
  };
  if (JSON.stringify(input).length > L.maxTotalChars) {
    input.findings = input.findings.slice(0, 10);
  }
  return input;
}
