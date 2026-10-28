// Minimized, sanitized input for Tool 11 AI interpretation.
// Built ONLY from the stored SeoDiagnostic + finding rows.
// Sent: sanitized website URL, execution status, final URL, homepage /
// robots / sitemap summaries (counts and statuses only), spam-signal
// categories (labels only), SEO-plugin statuses (slugs + statuses),
// search-console status, and deterministic finding IDs/titles/evidence
// (codes and bounded summaries only). Never sent: HTML bodies, matched
// snippets, credentials, secrets, config, absolute paths, user lists,
// or any client-supplied data.
export const SEO_AI_INPUT_LIMITS = Object.freeze({
  maxTotalChars: 8000,
  findingTitleMax: 300,
  findingDescriptionMax: 1000,
  recommendationMax: 500,
});

function cap(value, max) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

export function buildSeoAiInput(diagnostic, findings = []) {
  const L = SEO_AI_INPUT_LIMITS;
  const homepage = diagnostic.homepageSummary && typeof diagnostic.homepageSummary === "object" ? diagnostic.homepageSummary : {};
  const robots = diagnostic.robotsSummary && typeof diagnostic.robotsSummary === "object" ? diagnostic.robotsSummary : {};
  const sitemap = diagnostic.sitemapSummary && typeof diagnostic.sitemapSummary === "object" ? diagnostic.sitemapSummary : {};
  const spam = diagnostic.spamSignals && typeof diagnostic.spamSignals === "object" ? diagnostic.spamSignals : {};
  const seoPlugin = diagnostic.seoPluginSummary && typeof diagnostic.seoPluginSummary === "object" ? diagnostic.seoPluginSummary : {};
  const input = {
    sanitizedWebsiteUrl: diagnostic.sanitizedWebsiteUrl,
    finalUrl: diagnostic.finalUrl,
    executionStatus: diagnostic.executionStatus,
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    searchConsoleStatus: diagnostic.searchConsoleStatus,
    homepageSummary: {
      finalStatus: homepage.finalStatus ?? null,
      redirectCount: homepage.redirectCount ?? null,
      crossHostRedirect: homepage.crossHostRedirect ?? null,
      terminalError: homepage.terminalError ?? null,
      titlePresent: homepage.title?.present ?? null,
      titleLength: homepage.title?.length ?? null,
      robotsTokens: homepage.robotsTokens ?? [],
      canonicalPresent: homepage.canonicalPresent ?? null,
    },
    robotsSummary: {
      present: robots.present ?? null,
      status: robots.status ?? null,
      blocksHomepage: robots.blocksHomepage ?? null,
      sitemapCount: Array.isArray(robots.sitemapUrls) ? robots.sitemapUrls.length : 0,
    },
    sitemapSummary: {
      status: sitemap.status ?? null,
      sitemapsChecked: sitemap.sitemapsChecked ?? null,
      entryCount: sitemap.entryCount ?? null,
      homepagePresent: sitemap.homepagePresent ?? null,
    },
    spamSignals: {
      keywordCategories: spam.keywordCategories ?? [],
      externalLinkCount: spam.externalLinkCount ?? null,
      hiddenLinkCount: spam.hiddenLinkCount ?? null,
    },
    seoPluginSummary: {
      status: seoPlugin.status ?? null,
      activeSlugs: seoPlugin.activeSlugs ?? [],
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
      checkId: f.checkId ?? null,
    })),
  };
  if (JSON.stringify(input).length > L.maxTotalChars) {
    input.findings = input.findings.slice(0, 10);
  }
  return input;
}
