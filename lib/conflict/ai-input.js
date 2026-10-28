// Minimized, sanitized diagnostic input for Tool 02 AI interpretation.
// Built ONLY from the stored ConflictDiagnostic + ConflictFinding rows.
// Sent: sanitized inventory (names/versions/requirements/dependencies /
// update flags), deterministic findings, sanitized symptom category +
// description, and the error excerpt CLEARLY LABELLED as untrusted user
// text. Never sent: credentials, keys, tokens, logs, user ids, emails,
// site URLs, plugin file paths, or raw snapshot internals beyond the
// inventory fields listed here.

export const CONFLICT_AI_INPUT_LIMITS = Object.freeze({
  maxTotalChars: 8000,
  findingTitleMax: 300,
  findingDescriptionMax: 1000,
  recommendationMax: 500,
  maxPlugins: 50,
});

function cap(value, max) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function buildConflictAiInput(diagnostic, findings = []) {
  const L = CONFLICT_AI_INPUT_LIMITS;
  const payload = diagnostic.snapshotPayload && typeof diagnostic.snapshotPayload === "object" ? diagnostic.snapshotPayload : {};
  const plugins = Array.isArray(payload.plugins)
    ? payload.plugins.slice(0, L.maxPlugins).map((p) => ({
        name: p?.name ?? null,
        version: p?.version ?? null,
        active: p?.active ?? null,
        requiresWP: p?.requiresWP ?? null,
        requiresPHP: p?.requiresPHP ?? null,
        dependencies: Array.isArray(p?.dependencies) ? p.dependencies : [],
        updateAvailable: p?.updateAvailable ?? null,
        newVersion: p?.newVersion ?? null,
      }))
    : Array.isArray(payload.activePlugins)
      ? payload.activePlugins.slice(0, L.maxPlugins).map((p) => ({ name: p?.name ?? null, version: p?.version ?? null, active: true }))
      : [];
  const input = {
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    wordpressVersion: payload.wordpressVersion ?? null,
    phpVersion: payload.phpVersion ?? null,
    theme: payload.theme ?? payload.activeTheme ?? null,
    plugins,
    symptomCategory: diagnostic.symptomCategory,
    symptomDescription: cap(diagnostic.symptomDescription, 1000),
    // Explicitly labelled: untrusted user-supplied text, not evidence.
    untrustedUserErrorText: diagnostic.errorExcerpt ? cap(diagnostic.errorExcerpt, 1000) : null,
    findings: findings.map((f) => ({
      id: f.id,
      ruleId: f.ruleId,
      title: cap(f.title, L.findingTitleMax),
      description: cap(f.description, L.findingDescriptionMax),
      severity: f.severity,
      status: f.status,
      recommendation: cap(f.recommendation, L.recommendationMax),
      confidence: f.confidence,
    })),
    unavailableChecks: [
      "Server logs: not collected",
      "TLS certificate detail: not collected",
      "Database state: not collected",
      "Plugin file contents beyond headers: not collected",
    ],
    evidenceNote:
      "The findings above are the complete deterministic evidence. Do not assume any other test was performed, and do not present any plugin or theme as a confirmed cause.",
  };
  let json = JSON.stringify(input);
  if (json.length > L.maxTotalChars) {
    input.findings = input.findings.map((f) => ({ ...f, description: f.description ? f.description.slice(0, 300) : f.description }));
    json = JSON.stringify(input);
  }
  if (json.length > L.maxTotalChars) {
    input.findings = input.findings.slice(0, 10);
  }
  return input;
}
