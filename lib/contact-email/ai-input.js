// Minimized, sanitized input for Tool 07 AI interpretation.
// Built ONLY from the stored ContactEmailDiagnostic + finding rows.
// Sent: sanitized target, email domain (domain only), execution status,
// snapshot status, SPF/DMARC/DKIM observation statuses (public TXT
// excerpts capped at 512 chars by the DNS module), sender comparison
// (domain-only), summary, and deterministic finding IDs/titles/evidence.
// Never sent: API keys, credentials, secrets, full email addresses,
// recipients, form submissions, message bodies, raw config, user ids, or
// any client-supplied score/metric (none are ever accepted).
export const CONTACT_EMAIL_AI_INPUT_LIMITS = Object.freeze({
  maxTotalChars: 8000,
  findingTitleMax: 300,
  findingDescriptionMax: 1000,
  recommendationMax: 500,
});

function cap(value, max) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

function observation(obs) {
  if (!obs || typeof obs !== "object") return null;
  return {
    status: obs.status ?? null,
    policy: obs.policy ?? null,
    selector: obs.selector ?? null,
    recordCount: obs.recordCount ?? null,
    anomalies: Array.isArray(obs.anomalies) ? obs.anomalies.slice(0, 10) : [],
    excerpt: Array.isArray(obs.excerpt) ? obs.excerpt.slice(0, 2).map((s) => (typeof s === "string" ? s.slice(0, 512) : null)) : [],
  };
}

export function buildContactEmailAiInput(diagnostic, findings = []) {
  const L = CONTACT_EMAIL_AI_INPUT_LIMITS;
  const summary = diagnostic.summary && typeof diagnostic.summary === "object" ? diagnostic.summary : null;
  const input = {
    sanitizedTargetUrl: diagnostic.sanitizedTargetUrl,
    sanitizedEmailDomain: diagnostic.sanitizedEmailDomain,
    executionStatus: diagnostic.executionStatus,
    snapshotStatus: summary?.snapshotStatus ?? null,
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    senderComparison: summary?.senderComparison ?? null,
    spf: observation(diagnostic.spfObservation),
    dmarc: observation(diagnostic.dmarcObservation),
    dkim: observation(diagnostic.dkimObservation),
    summary: summary
      ? { emailDomainSource: summary.emailDomainSource ?? null, spfStatus: summary.spfStatus ?? null, dmarcStatus: summary.dmarcStatus ?? null, dmarcPolicy: summary.dmarcPolicy ?? null, dkimStatus: summary.dkimStatus ?? null, dnsFailed: summary.dnsFailed ?? null }
      : null,
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
    })),
  };
  if (JSON.stringify(input).length > L.maxTotalChars) {
    input.findings = input.findings.slice(0, 10);
  }
  return input;
}
