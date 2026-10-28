// Minimized, sanitized diagnostic input for Tool 04 AI interpretation.
// Built ONLY from the stored ElementorDiagnostic + finding rows.
// Sent: versions, Elementor/Pro status + versions, theme name/version,
// other active plugin NAMES only (never versions of unrelated plugins in
// bulk — names are enough to discuss candidates), environment limits,
// deterministic findings, symptom fields, and the error excerpt CLEARLY
// LABELLED as untrusted user text. Never sent: credentials, keys, tokens,
// passwords, cookies, logs, HTML, post bodies, personal data, site URLs,
// user ids, emails, arbitrary config, or raw snapshot internals.
export const ELEMENTOR_AI_INPUT_LIMITS = Object.freeze({
  maxTotalChars: 8000,
  findingTitleMax: 300,
  findingDescriptionMax: 1000,
  recommendationMax: 500,
  maxOtherPlugins: 50,
});

function cap(value, max) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function buildElementorAiInput(diagnostic, findings = []) {
  const L = ELEMENTOR_AI_INPUT_LIMITS;
  const payload = diagnostic.snapshotPayload && typeof diagnostic.snapshotPayload === "object" ? diagnostic.snapshotPayload : {};
  const el = payload.elementor && typeof payload.elementor === "object" ? payload.elementor : null;
  const env = payload.environment && typeof payload.environment === "object" ? payload.environment : null;
  const otherNames = Array.isArray(payload.plugins)
    ? payload.plugins
        .filter((p) => p && typeof p === "object" && (p.active === true || p.networkActive === true) && p.slug !== "elementor" && p.slug !== "elementor-pro")
        .slice(0, L.maxOtherPlugins)
        .map((p) => p.name)
        .filter((n) => typeof n === "string")
    : [];
  const input = {
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    wordpressVersion: payload.wordpressVersion ?? null,
    phpVersion: payload.phpVersion ?? null,
    themeName: payload.theme?.name ?? null,
    themeVersion: payload.theme?.version ?? null,
    elementor: el
      ? {
          status: el.status ?? null,
          version: el.version ?? null,
          pro: el.pro ? { installed: el.pro.installed ?? null, active: el.pro.active ?? null, version: el.pro.version ?? null } : null,
        }
      : null,
    environment: env
      ? { phpMemoryLimit: env.phpMemoryLimit ?? null, wpMemoryLimit: env.wpMemoryLimit ?? null, maxExecutionTime: env.maxExecutionTime ?? null }
      : null,
    otherActivePluginNames: otherNames,
    symptomCategory: diagnostic.symptomCategory,
    symptomDescription: cap(diagnostic.symptomDescription, 1000),
    affectedScopeReported: diagnostic.affectedScope ?? null,
    affectedPagesReported: diagnostic.affectedPages ?? null,
    deviceScopeReported: diagnostic.deviceScope ?? null,
    updatePrecededReported: diagnostic.updatePreceded ?? null,
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
      "Browser console output: not collected",
      "Frontend rendering / visual inspection: not performed",
      "Screenshots / images: not collected and not analysed",
      "Server logs: not collected",
      "Plugin isolation / deactivation tests: not performed",
      "Theme switching tests: not performed",
      "Live editor session: not observed",
    ],
    evidenceNote:
      "The findings above are the complete deterministic evidence. Do not assume any other test was performed, and do not present any plugin, theme, version, or memory limit as a confirmed cause of an editor or layout symptom.",
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
