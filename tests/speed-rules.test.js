// Tool 05 deterministic engine (groups D, E): hard distinctions tested.
import test from "node:test";
import assert from "node:assert/strict";
import { runSpeedRules } from "../lib/speed/engine.js";

const httpOk = { status: 200, redirectCount: 0, finalUrl: "https://example.com/", elapsedMs: 400 };
const labGood = { score100: 95, fcpMs: 900, lcpMs: 2000, tbtMs: 100, cls: 0.02, speedIndexMs: 1500, interactiveMs: 2000, serverResponseMs: 200, inpMs: null, audits: [] };
const cruxGood = {
  scope: "page", formFactor: "PHONE",
  metrics: {
    lcp: { p75Ms: 2000, classification: "GOOD", distributions: null },
    inp: { p75Ms: 150, classification: "GOOD", distributions: null },
    cls: { p75: 0.05, classification: "GOOD", distributions: null },
  },
  collectionPeriod: { firstDate: { year: 2026, month: 9, day: 29 }, lastDate: { year: 2026, month: 10, day: 26 } },
};

test("all good: no findings, no unavailable notices", () => {
  const { findings, notices } = runSpeedRules({ http: httpOk, lighthouse: labGood, crux: cruxGood, providerStatuses: { psi: "OK", crux: "OK" } });
  assert.deepEqual(findings, []);
  assert.deepEqual(notices, []);
});

test("lab poor LCP/CLS/TBT produce findings; TBT finding never mentions INP as its metric", () => {
  const { findings } = runSpeedRules({
    http: httpOk,
    lighthouse: { ...labGood, lcpMs: 4500, cls: 0.3, tbtMs: 900 },
    crux: cruxGood, providerStatuses: { psi: "OK", crux: "OK" },
  });
  const cats = findings.map((f) => f.category);
  assert.ok(cats.includes("HIGH_LCP"));
  assert.ok(cats.includes("HIGH_CLS"));
  assert.ok(cats.includes("HIGH_TBT"));
  const tbt = findings.find((f) => f.category === "HIGH_TBT");
  assert.equal(tbt.sourceMetric, "tbtMs");
  assert.match(tbt.description, /NOT Interaction to Next Paint/);
  assert.ok(!findings.some((f) => f.category === "HIGH_INP"));
});

test("field poor values produce CRUX findings with scope labels; origin data labelled origin, never page", () => {
  const origin = {
    ...cruxGood, scope: "origin",
    metrics: {
      lcp: { p75Ms: 5000, classification: "POOR", distributions: null },
      inp: { p75Ms: 600, classification: "POOR", distributions: null },
      cls: { p75: 0.3, classification: "POOR", distributions: null },
    },
  };
  const { findings } = runSpeedRules({ http: httpOk, lighthouse: labGood, crux: origin, providerStatuses: { psi: "OK", crux: "OK_ORIGIN_FALLBACK" } });
  assert.ok(findings.every((f) => f.source === "CRUX"));
  assert.ok(findings.every((f) => f.description.includes("origin-level")));
  assert.ok(!findings.some((f) => f.description.includes("page-level")));
});

test("missing field data creates a notice, NOT a finding; missing data is never GOOD", () => {
  const { findings, notices } = runSpeedRules({ http: httpOk, lighthouse: labGood, crux: null, providerStatuses: { psi: "OK", crux: "NO_FIELD_DATA" } });
  assert.deepEqual(findings, []);
  assert.ok(notices.some((n) => n.code === "FIELD_DATA_UNAVAILABLE"));
});

test("missing lab data creates a notice, NOT a finding; both missing adds INSUFFICIENT_EVIDENCE notice", () => {
  const { findings, notices } = runSpeedRules({ http: httpOk, lighthouse: null, crux: null, providerStatuses: { psi: "NOT_CONFIGURED", crux: "NOT_CONFIGURED" } });
  assert.deepEqual(findings, []);
  assert.ok(notices.some((n) => n.code === "LAB_DATA_UNAVAILABLE"));
  assert.ok(notices.some((n) => n.code === "FIELD_DATA_UNAVAILABLE"));
  assert.ok(notices.some((n) => n.code === "INSUFFICIENT_EVIDENCE"));
});

test("audit interpreter: render-blocking + unused JS + compression map; unknown audit skipped as finding, noted", () => {
  const lab = {
    ...labGood,
    audits: [
      { id: "render-blocking-resources", title: "Eliminate render-blocking resources", score: 0.5, displayValue: "Potential savings of 400 ms", numericValue: 400, numericUnit: "millisecond", overallSavingsMs: 400, overallSavingsBytes: null },
      { id: "unused-javascript", title: "Remove unused JavaScript", score: 0.6, displayValue: "Potential savings of 120 KiB", numericValue: 120000, numericUnit: "byte", overallSavingsMs: null, overallSavingsBytes: 120000 },
      { id: "uses-text-compression", title: "Enable text compression", score: 0, displayValue: "Potential savings of 30 KiB", numericValue: 30000, numericUnit: "byte", overallSavingsMs: null, overallSavingsBytes: 30000 },
      { id: "uses-long-cache-ttl", title: "Serve static assets with an efficient cache policy", score: 1, displayValue: null, numericValue: null, numericUnit: null, overallSavingsMs: null, overallSavingsBytes: null },
      { id: "brand-new-audit-2099", title: "Future", score: 0.1, displayValue: "x", numericValue: 1, numericUnit: "unitless", overallSavingsMs: null, overallSavingsBytes: null },
    ],
  };
  const { findings, notices } = runSpeedRules({ http: httpOk, lighthouse: lab, crux: cruxGood, providerStatuses: { psi: "OK", crux: "OK" } });
  const cats = findings.map((f) => f.category);
  assert.ok(cats.includes("RENDER_BLOCKING_RESOURCE"));
  assert.ok(cats.includes("UNUSED_ASSET"));
  assert.ok(cats.includes("COMPRESSION_OPPORTUNITY"));
  assert.ok(!cats.includes("CACHING_OPPORTUNITY")); // passing audit (score 1) is not a finding
  assert.ok(!findings.some((f) => f.sourceAuditId === "brand-new-audit-2099"));
  assert.ok(notices.some((n) => n.code === "UNKNOWN_AUDITS_PRESERVED"));
  const rb = findings.find((f) => f.category === "RENDER_BLOCKING_RESOURCE");
  assert.equal(rb.evidence.estimatedSavingsMs, 400);
});

test("HTTP slow total response and HTTP error status produce findings; elapsed is total, never TTFB", () => {
  const { findings } = runSpeedRules({ http: { status: 200, redirectCount: 1, finalUrl: "https://example.com/", elapsedMs: 3500 }, lighthouse: labGood, crux: cruxGood, providerStatuses: { psi: "OK", crux: "OK" } });
  const slow = findings.find((f) => f.category === "SLOW_HTTP_RESPONSE" && f.source === "HTTP");
  assert.ok(slow);
  assert.equal(slow.severity, "HIGH");
  assert.match(slow.description, /NOT time-to-first-byte/);

  const { findings: f2 } = runSpeedRules({ http: { status: 500, redirectCount: 0, finalUrl: "https://example.com/", elapsedMs: 300 }, lighthouse: labGood, crux: cruxGood, providerStatuses: { psi: "OK", crux: "OK" } });
  assert.ok(f2.some((f) => f.category === "HTTP_RESPONSE_ERROR"));
});
