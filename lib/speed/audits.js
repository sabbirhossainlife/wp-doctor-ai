// Data-driven Lighthouse audit interpreter (Milestone 9).
// Known audit IDs map to deterministic finding templates; the title,
// display value, score and savings shown are ALWAYS the provider's own
// values from the response — never invented. An audit with score 1 (or
// null score with no savings) produces no finding: a high score is not
// proof of a defect, and a passing audit is not a finding.
// Unknown / future / deprecated audit IDs are NOT turned into findings:
// they are preserved verbatim (bounded) inside lighthouseSummary.audits
// and counted in auditCount, so no provider information is silently
// dropped and none is fabricated. Savings are provider estimates only.
export const KNOWN_AUDIT_FINDINGS = Object.freeze({
  "render-blocking-resources": {
    category: "RENDER_BLOCKING_RESOURCE",
    title: "Render-blocking resources delay first paint",
    recommendation:
      "Defer or inline only the critical CSS/JS for above-the-fold content, and test on staging before changing production assets. Savings shown are a Lighthouse estimate, not a guaranteed gain.",
  },
  "unused-javascript": {
    category: "UNUSED_ASSET",
    title: "Unused JavaScript is shipped to visitors",
    recommendation:
      "Remove or defer unused scripts, or split bundles so each page loads only the code it uses. Verify on staging; savings shown are a Lighthouse estimate.",
  },
  "unused-css-rules": {
    category: "UNUSED_ASSET",
    title: "Unused CSS rules are shipped to visitors",
    recommendation:
      "Remove unused CSS or split styles per template, and verify layout on staging before deploying. Savings shown are a Lighthouse estimate.",
  },
  "uses-text-compression": {
    category: "COMPRESSION_OPPORTUNITY",
    title: "Text compression is not applied to some responses",
    recommendation:
      "Enable gzip or Brotli compression for text responses at the server or CDN level. Savings shown are a Lighthouse estimate.",
  },
  "uses-long-cache-ttl": {
    category: "CACHING_OPPORTUNITY",
    title: "Static assets use short cache lifetimes",
    recommendation:
      "Set long cache lifetimes with cache-busting filenames for static assets that rarely change. Do not cache HTML pages that change per visitor.",
  },
  "uses-optimized-images": {
    category: "IMAGE_OPTIMIZATION",
    title: "Images can be served more efficiently",
    recommendation:
      "Serve appropriately compressed images in modern formats where supported, and verify visual quality on staging. Savings shown are a Lighthouse estimate.",
  },
  "uses-responsive-images": {
    category: "IMAGE_OPTIMIZATION",
    title: "Images are larger than the displayed size on some viewports",
    recommendation:
      "Serve responsive image sizes so small screens do not download desktop-sized images. Savings shown are a Lighthouse estimate.",
  },
  "uses-webp-images": {
    category: "IMAGE_OPTIMIZATION",
    title: "Images could use a more efficient modern format",
    recommendation:
      "Consider modern image formats with fallbacks for older browsers, and verify quality on staging. Savings shown are a Lighthouse estimate.",
  },
  "server-response-time": {
    category: "SLOW_HTTP_RESPONSE",
    title: "Server response time is slow in the lab run",
    recommendation:
      "Investigate server response time (hosting, caching, database queries) — this lab value is separate from the basic HTTP total response time measured by the preflight.",
  },
  "mainthread-work-breakdown": {
    category: "HIGH_TBT",
    title: "Main-thread work is high in the lab run",
    recommendation:
      "Reduce long main-thread tasks (heavy scripts, long tasks) so the page stays responsive. This contributes to Total Blocking Time; it is not the same metric as field INP.",
  },
  "bootup-time": {
    category: "HIGH_TBT",
    title: "JavaScript boot-up time is high in the lab run",
    recommendation:
      "Defer non-critical scripts and reduce JavaScript execution on page load. This contributes to Total Blocking Time; it is not the same metric as field INP.",
  },
});

export function buildAuditFindings(auditSummaries = []) {
  const findings = [];
  let unknownAuditCount = 0;
  for (const audit of auditSummaries) {
    const template = KNOWN_AUDIT_FINDINGS[audit.id];
    if (!template) { unknownAuditCount += 1; continue; }
    const hasSavings =
      (typeof audit.overallSavingsMs === "number" && audit.overallSavingsMs > 0) ||
      (typeof audit.overallSavingsBytes === "number" && audit.overallSavingsBytes > 0);
    const failing = typeof audit.score === "number" && audit.score < 1;
    if (!failing && !hasSavings) continue;
    findings.push({
      ruleId: `AUDIT_${audit.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`,
      category: template.category,
      severity: typeof audit.score === "number" && audit.score < 0.5 ? "HIGH" : "MEDIUM",
      source: "LIGHTHOUSE",
      sourceAuditId: audit.id,
      sourceMetric: null,
      title: template.title,
      description:
        `Lighthouse audit "${audit.title ?? audit.id}"` +
        (audit.displayValue ? ` reports ${audit.displayValue}.` : " did not pass.") +
        " This is a lab observation from Google's Lighthouse run, not a real-user measurement.",
      evidence: {
        auditId: audit.id,
        auditTitle: audit.title ?? null,
        auditScore: audit.score ?? null,
        displayValue: audit.displayValue ?? null,
        numericValue: audit.numericValue ?? null,
        numericUnit: audit.numericUnit ?? null,
        estimatedSavingsMs: audit.overallSavingsMs ?? null,
        estimatedSavingsBytes: audit.overallSavingsBytes ?? null,
      },
      recommendation: template.recommendation,
      confidence: "MEDIUM",
      relatedMetric: null,
    });
  }
  return { findings, unknownAuditCount };
}
