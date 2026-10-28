// Minimized, sanitized input for Tool 06 AI interpretation.
// Built ONLY from the stored SslRedirectDiagnostic + finding rows.
// Sent: sanitized target, execution status, cert status, TLS outcome
// (verified flag, hostname, validity dates, protocol, cipher — never
// unverified certificate fields), redirect chain (sanitized URLs,
// statuses, host-changed flags, schemes, TLS verified flags, outcomes),
// summary, limitations, and deterministic finding IDs/titles/evidence.
// Never sent: API keys, credentials, cookies, passwords, query strings,
// fragments, raw responses/bodies, internal IPs, user ids, emails, or
// any client-supplied score/metric (none are ever accepted).
export const SSL_AI_INPUT_LIMITS = Object.freeze({
  maxTotalChars: 8000,
  findingTitleMax: 300,
  findingDescriptionMax: 1000,
  recommendationMax: 500,
});

function cap(value, max) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function buildSslAiInput(diagnostic, findings = []) {
  const L = SSL_AI_INPUT_LIMITS;
  const tls = diagnostic.tlsOutcome && typeof diagnostic.tlsOutcome === "object" ? diagnostic.tlsOutcome : null;
  const summary = diagnostic.summary && typeof diagnostic.summary === "object" ? diagnostic.summary : null;
  const chain = Array.isArray(diagnostic.redirectChain) ? diagnostic.redirectChain.slice(0, 12) : [];
  const input = {
    sanitizedTargetUrl: diagnostic.sanitizedTargetUrl,
    executionStatus: diagnostic.executionStatus,
    certStatus: summary?.certStatus ?? null,
    tls: tls
      ? {
          verified: tls.verified ?? null,
          errorCode: tls.errorCode ?? null,
          hostname: tls.certificate?.hostname ?? null,
          validFrom: tls.verified ? tls.certificate?.validFrom ?? null : null,
          validTo: tls.verified ? tls.certificate?.validTo ?? null : null,
          daysToExpiry: tls.verified ? tls.daysToExpiry ?? null : null,
          protocol: tls.verified ? tls.certificate?.protocol ?? null : null,
          cipher: tls.verified ? tls.certificate?.cipher ?? null : null,
        }
      : null,
    redirectChain: chain.map((h) => ({
      step: h.step ?? null,
      url: h.url ?? null,
      status: h.status ?? null,
      destination: h.destination ?? null,
      hostChanged: h.hostChanged ?? null,
      scheme: h.scheme ?? null,
      tlsVerified: h.tlsResult ? h.tlsResult.verified ?? null : null,
      tlsErrorCode: h.tlsResult ? h.tlsResult.errorCode ?? null : null,
      outcome: h.outcome ?? null,
    })),
    summary: summary
      ? { finalUrl: summary.finalUrl ?? null, finalStatus: summary.finalStatus ?? null, redirectCount: summary.redirectCount ?? null, crossHost: summary.crossHost ?? null, downgradeBlocked: summary.downgradeBlocked ?? null, terminalReason: summary.terminalReason ?? null }
      : null,
    limitations: Array.isArray(diagnostic.limitations) ? diagnostic.limitations.slice(0, 20) : [],
    findings: findings.map((f) => ({
      id: f.id,
      code: f.code,
      severity: f.severity,
      title: cap(f.title, L.findingTitleMax),
      explanation: cap(f.explanation, L.findingDescriptionMax),
      evidence: f.evidence ?? {},
      recommendation: cap(f.recommendation, L.recommendationMax),
      confidence: f.confidence ?? null,
    })),
  };
  const serialized = JSON.stringify(input);
  if (serialized.length > L.maxTotalChars) {
    input.findings = input.findings.slice(0, 10);
  }
  return input;
}
