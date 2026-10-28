// Minimized, sanitized input for Tool 05 AI interpretation.
// Built ONLY from the stored SpeedDiagnostic + finding rows.
// Sent: strategy, provider target (query-stripped), HTTP summary (status +
// total response time — never labelled TTFB), Lighthouse lab metrics with
// explicit LAB labels, CrUX field p75 values with explicit FIELD labels,
// scope (page|origin), form factor, collection period, provider statuses,
// notices, and deterministic finding IDs/titles/evidence.
// Never sent: API keys, credentials, cookies, passwords, query strings,
// raw provider responses, raw HTML/bodies, internal IPs, user ids, emails,
// or any client-supplied score/metric (none are ever accepted).
export const SPEED_AI_INPUT_LIMITS = Object.freeze({
  maxTotalChars: 8000,
  findingTitleMax: 300,
  findingDescriptionMax: 1000,
  recommendationMax: 500,
});

function cap(value, max) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function buildSpeedAiInput(diagnostic, findings = []) {
  const L = SPEED_AI_INPUT_LIMITS;
  const http = diagnostic.httpSummary && typeof diagnostic.httpSummary === "object" ? diagnostic.httpSummary : null;
  const lab = diagnostic.lighthouseSummary && typeof diagnostic.lighthouseSummary === "object" ? diagnostic.lighthouseSummary : null;
  const field = diagnostic.cruxSummary && typeof diagnostic.cruxSummary === "object" ? diagnostic.cruxSummary : null;
  const input = {
    strategy: diagnostic.strategy,
    providerTarget: diagnostic.providerTarget ?? null,
    queryStripped: true,
    reportStatus: diagnostic.status,
    providerStatuses: diagnostic.providerStatuses ?? null,
    http: http
      ? { status: http.status ?? null, totalResponseMs: http.elapsedMs ?? null, redirectCount: http.redirectCount ?? null, errorCode: http.errorCode ?? null }
      : null,
    lab: lab
      ? {
          source: "LIGHTHOUSE_LAB",
          score100: lab.score100 ?? null,
          fcpMs: lab.fcpMs ?? null,
          lcpMs: lab.lcpMs ?? null,
          tbtMs: lab.tbtMs ?? null,
          cls: lab.cls ?? null,
          speedIndexMs: lab.speedIndexMs ?? null,
          interactiveMs: lab.interactiveMs ?? null,
          serverResponseMs: lab.serverResponseMs ?? null,
          inpMs: lab.inpMs ?? null,
        }
      : null,
    field: field
      ? {
          source: "CRUX_FIELD",
          scope: field.scope ?? null,
          formFactor: field.formFactor ?? null,
          collectionPeriod: field.collectionPeriod ?? null,
          lcpP75Ms: field.metrics?.lcp?.p75Ms ?? null,
          inpP75Ms: field.metrics?.inp?.p75Ms ?? null,
          clsP75: field.metrics?.cls?.p75 ?? null,
        }
      : null,
    notices: Array.isArray(diagnostic.notices) ? diagnostic.notices.slice(0, 20) : [],
    findings: findings.map((f) => ({
      id: f.id,
      ruleId: f.ruleId,
      category: f.category,
      severity: f.severity,
      source: f.source,
      sourceAuditId: f.sourceAuditId ?? null,
      sourceMetric: f.sourceMetric ?? null,
      title: cap(f.title, L.findingTitleMax),
      description: cap(f.description, L.findingDescriptionMax),
      evidence: f.evidence ?? {},
      recommendation: cap(f.recommendation, L.recommendationMax),
    })),
  };
  const serialized = JSON.stringify(input);
  if (serialized.length > L.maxTotalChars) {
    input.findings = input.findings.slice(0, 10);
  }
  return input;
}
