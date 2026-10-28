// Tool 11 AI validation tests (mock-free: pure validator + input builder).
import test from "node:test";
import assert from "node:assert/strict";
import { validateSeoAnalysis, SEO_AI_SCHEMA_VERSION } from "../lib/seo/ai-validate.js";
import { buildSeoAiInput } from "../lib/seo/ai-input.js";

function valid(findingId = "f1") {
  return {
    schemaVersion: "seo-1",
    summary: "The homepage carries a noindex signal and no sitemap was found in the checked locations.",
    explanation: "The deterministic report shows a meta robots noindex token and no reachable sitemap; index status itself is unknown without Search Console data.",
    diagnosticConfidence: "MEDIUM",
    confirmedObservations: [{ findingId, observation: "The homepage meta robots tag includes noindex." }],
    causeHypotheses: [{
      title: "Staging setting left enabled",
      explanation: "A noindex directive is often left over from staging.",
      confidence: "LOW",
      supportingFindingIds: [findingId],
      additionalEvidenceRequired: "Confirmation from the site owner whether the page should be searchable.",
    }],
    recommendedActions: [{
      title: "Verify index status in Search Console",
      description: "Use URL Inspection to check real coverage for the homepage.",
      priority: "HIGH",
    }],
    missingEvidence: ["Search Console data"],
    limitations: ["Head evidence covers the first 64 KiB only."],
    humanReviewRecommended: true,
  };
}

test("seo ai-validate: valid analysis passes; schema version is seo-1", () => {
  assert.equal(SEO_AI_SCHEMA_VERSION, "seo-1");
  assert.deepEqual(validateSeoAnalysis(valid(), ["f1"]), valid());
});

test("seo ai-validate: unknown finding reference rejected", () => {
  assert.throws(() => validateSeoAnalysis(valid("nope"), ["f1"]), /unknown finding/);
});

test("seo ai-validate: banned claims rejected (index state, confirmed spam, clean guarantees)", () => {
  const cases = [
    "The page is indexed in Google.",
    "The page is deindexed.",
    "The site is fully indexed.",
    "The site is SEO-clean.",
    "The site is spam-free.",
    "SEO spam was confirmed on the homepage.",
    "The site was hacked.",
    "The problem was fixed by the tool.",
  ];
  for (const text of cases) {
    const a = valid();
    a.summary = text;
    assert.throws(() => validateSeoAnalysis(a, ["f1"]), /forbidden claim/, text);
  }
});

test("seo ai-validate: wrong schema version and unknown keys rejected", () => {
  const a = valid();
  a.schemaVersion = "malware-1";
  assert.throws(() => validateSeoAnalysis(a, ["f1"]), /schemaVersion/);
  const b = valid();
  b.extraField = true;
  assert.throws(() => validateSeoAnalysis(b, ["f1"]), /not a supported field/);
});

test("seo ai-input: bounded, sanitized — no bodies, snippets, or secrets", () => {
  const diagnostic = {
    sanitizedWebsiteUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    executionStatus: "COMPLETED",
    snapshotSchemaVersion: 7,
    searchConsoleStatus: "NOT_CONFIGURED",
    homepageSummary: {
      finalStatus: 200, redirectCount: 0, crossHostRedirect: false, terminalError: null,
      title: { present: true, length: 20 }, robotsTokens: ["noindex"], canonicalPresent: true,
    },
    robotsSummary: { present: true, status: 200, blocksHomepage: false, sitemapUrls: ["https://example.com/sitemap.xml"] },
    sitemapSummary: { status: "OK", sitemapsChecked: 1, entryCount: 3, homepagePresent: true },
    spamSignals: { keywordCategories: ["gambling"], externalLinkCount: 0, hiddenLinkCount: 0 },
    seoPluginSummary: { status: "SEO_PLUGIN_ACTIVE", activeSlugs: ["rank-math"] },
    limitations: ["Head evidence covers the first 64 KiB only."],
  };
  const findings = [{
    id: "f1", code: "META_ROBOTS_NOINDEX", severity: "HIGH", title: "Homepage carries a noindex signal",
    explanation: "The meta robots tag includes noindex.",
    evidence: { robotsTokens: ["noindex"] }, recommendation: "Remove noindex if searchable.",
    confidence: "HIGH", evidenceStatus: "OBSERVED", checkId: "head",
  }];
  const input = buildSeoAiInput(diagnostic, findings);
  const json = JSON.stringify(input);
  assert.ok(json.length <= 8000);
  assert.ok(!json.includes("<html"));
  assert.ok(!json.includes("We sell"));
  assert.equal(input.spamSignals.keywordCategories[0], "gambling");
  assert.equal(input.findings[0].id, "f1");
});
