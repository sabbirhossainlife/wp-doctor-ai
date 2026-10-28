// Minimized, sanitized diagnostic input for Tool 03 AI interpretation.
// Built ONLY from the stored WooCommerceDiagnostic + finding rows.
// Sent: versions, normalized page configuration (role/id/status/
// implementation — never page bodies), minimal gateway metadata
// (id/title/enabled/blockCompatibility ONLY), deterministic findings,
// symptom category/description, and the error excerpt CLEARLY LABELLED as
// untrusted user text. Never sent: credentials, keys, tokens, card data,
// customer data, order records, transaction data, webhook secrets, gateway
// settings, site URLs, user ids, emails, logs, or raw snapshot internals.
export const WOO_AI_INPUT_LIMITS = Object.freeze({
  maxTotalChars: 8000,
  findingTitleMax: 300,
  findingDescriptionMax: 1000,
  recommendationMax: 500,
  maxGateways: 50,
});

function cap(value, max) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function buildWooAiInput(diagnostic, findings = []) {
  const L = WOO_AI_INPUT_LIMITS;
  const payload = diagnostic.snapshotPayload && typeof diagnostic.snapshotPayload === "object" ? diagnostic.snapshotPayload : {};
  const woo = payload.woocommerce && typeof payload.woocommerce === "object" ? payload.woocommerce : null;
  const input = {
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    wordpressVersion: payload.wordpressVersion ?? null,
    phpVersion: payload.phpVersion ?? null,
    woocommerce: woo
      ? {
          status: woo.status ?? null,
          version: woo.version ?? null,
          pages: woo.pages ?? null,
          gateways: Array.isArray(woo.gateways)
            ? woo.gateways.slice(0, L.maxGateways).map((g) => ({
                id: g?.id ?? null,
                title: g?.title ?? null,
                enabled: g?.enabled ?? null,
                blockCompatibility: g?.blockCompatibility ?? null,
              }))
            : [],
        }
      : null,
    symptomCategory: diagnostic.symptomCategory,
    symptomDescription: cap(diagnostic.symptomDescription, 1000),
    checkoutTypeReported: diagnostic.checkoutType ?? null,
    affectedScopeReported: diagnostic.affectedScope ?? null,
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
      "Orders: not inspected",
      "Transactions / payment outcomes: not inspected",
      "Customer data: not collected",
      "Gateway credentials / settings / webhook secrets: not collected",
      "Server logs: not collected",
      "Live payment tests: never performed",
    ],
    evidenceNote:
      "The findings above are the complete deterministic evidence. Do not assume any other test was performed, and do not present any gateway, page, or version as a confirmed cause of a payment failure.",
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
