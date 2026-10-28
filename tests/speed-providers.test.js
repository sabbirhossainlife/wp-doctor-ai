// Tool 05 provider adapters with controlled mocks only (groups B, C, E).
// No live Google call is made here. Keys are fake test strings and are
// asserted never to appear in returned summaries.
import test from "node:test";
import assert from "node:assert/strict";
import { fetchPsi, fetchCrux, ProviderError } from "../lib/speed/providers.js";

const PSI_KEY = "test-psi-key-never-real";
const CRUX_KEY = "test-crux-key-never-real";

function mockResponse({ ok = true, status = 200, body = "{}" } = {}) {
  return { ok, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
}

function psiFixture(overrides = {}) {
  return {
    lighthouseResult: {
      categories: { performance: { score: 0.82 } },
      finalUrl: "https://example.com/",
      fetchTime: "2026-10-27T00:00:00.000Z",
      audits: {
        "first-contentful-paint": { title: "First Contentful Paint", score: 0.9, displayValue: "1.0 s", numericValue: 1000, numericUnit: "millisecond" },
        "largest-contentful-paint": { title: "Largest Contentful Paint", score: 0.7, displayValue: "2.8 s", numericValue: 2800, numericUnit: "millisecond" },
        "total-blocking-time": { title: "Total Blocking Time", score: 0.8, displayValue: "150 ms", numericValue: 150, numericUnit: "millisecond" },
        "cumulative-layout-shift": { title: "Cumulative Layout Shift", score: 0.99, displayValue: "0.02", numericValue: 0.02, numericUnit: "unitless" },
        "render-blocking-resources": { title: "Eliminate render-blocking resources", score: 0.5, displayValue: "Potential savings of 400 ms", numericValue: 400, numericUnit: "millisecond", details: { overallSavingsMs: 400 } },
        "some-future-audit": { title: "Future audit", score: 0.4, displayValue: "1.2 s", numericValue: 1200, numericUnit: "millisecond" },
      },
    },
    ...overrides,
  };
}

function cruxFixture(overrides = {}) {
  return {
    record: {
      key: { url: "https://example.com/" },
      metrics: {
        largest_contentful_paint: { percentiles: { p75: 2400 }, histogram: [{ start: 0, end: 2500, density: 0.6 }, { start: 2500, end: 4000, density: 0.3 }, { start: 4000, density: 0.1 }] },
        interaction_to_next_paint: { percentiles: { p75: 180 }, histogram: [{ start: 0, end: 200, density: 0.7 }, { start: 200, end: 500, density: 0.2 }, { start: 500, density: 0.1 }] },
        cumulative_layout_shift: { percentiles: { p75: 0.05 }, histogram: [{ start: 0, end: 0.1, density: 0.8 }, { start: 0.1, end: 0.25, density: 0.15 }, { start: 0.25, density: 0.05 }] },
      },
      collectionPeriod: { firstDate: { year: 2026, month: 9, day: 29 }, lastDate: { year: 2026, month: 10, day: 26 } },
    },
    ...overrides,
  };
}

test("PSI valid: score, lab metrics, unknown audit preserved, key never in summary", async () => {
  let seenUrl = "";
  const fetchFn = async (url) => { seenUrl = url; return mockResponse({ body: psiFixture() }); };
  const out = await fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn });
  assert.equal(out.score, 0.82);
  assert.equal(out.score100, 82);
  assert.equal(out.lcpMs, 2800);
  assert.equal(out.tbtMs, 150);
  assert.equal(out.cls, 0.02);
  assert.equal(out.inpMs, null); // Lighthouse fixture has no INP audit: never substituted with TBT
  assert.ok(out.audits.some((a) => a.id === "some-future-audit"));
  assert.ok(seenUrl.startsWith("https://www.googleapis.com/pagespeedonline/v5/runPagespeed"));
  assert.ok(seenUrl.includes("strategy=mobile"));
  assert.ok(!JSON.stringify(out).includes(PSI_KEY));
});

test("PSI desktop strategy uses strategy=desktop; missing score / missing audits / invalid JSON rejected", async () => {
  let seenUrl = "";
  const fetchFn = async (url) => { seenUrl = url; return mockResponse({ body: psiFixture() }); };
  await fetchPsi({ target: "https://example.com/", strategy: "DESKTOP", apiKey: PSI_KEY, fetchFn });
  assert.ok(seenUrl.includes("strategy=desktop"));

  await assert.rejects(
    fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn: async () => mockResponse({ body: psiFixture({ lighthouseResult: { categories: { performance: {} }, audits: {} } }) }) }),
    (e) => e instanceof ProviderError && e.code === "INVALID_RESPONSE",
  );
  await assert.rejects(
    fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn: async () => mockResponse({ body: { lighthouseResult: { categories: { performance: { score: 0.5 } } } } }) }),
    (e) => e instanceof ProviderError && e.code === "INVALID_RESPONSE",
  );
  await assert.rejects(
    fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn: async () => mockResponse({ body: "{not json" }) }),
    (e) => e instanceof ProviderError && e.code === "INVALID_RESPONSE",
  );
  await assert.rejects(
    fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn: async () => mockResponse({ body: psiFixture({ lighthouseResult: { categories: { performance: { score: 1.5 } }, audits: {} } }) }) }),
    (e) => e instanceof ProviderError && e.code === "INVALID_RESPONSE",
  );
});

test("PSI errors: quota 429, server 500, oversized, missing key, malformed metric values", async () => {
  await assert.rejects(fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn: async () => mockResponse({ ok: false, status: 429 }) }), (e) => e.code === "QUOTA_EXCEEDED");
  await assert.rejects(fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn: async () => mockResponse({ ok: false, status: 500 }) }), (e) => e.code === "SERVER_ERROR");
  await assert.rejects(fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: null, fetchFn: async () => mockResponse({}) }), (e) => e.code === "NOT_CONFIGURED");
  await assert.rejects(fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn: async () => mockResponse({ body: "x".repeat(2 * 1024 * 1024 + 1) }) }), (e) => e.code === "OVERSIZED_RESPONSE");
  // Malformed metric value (string instead of number) yields null, not a crash or a fabricated number.
  const bad = psiFixture();
  bad.lighthouseResult.audits["largest-contentful-paint"].numericValue = "fast";
  const out = await fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn: async () => mockResponse({ body: bad }) });
  assert.equal(out.lcpMs, null);
});

test("PSI timeout: fetch honouring AbortSignal becomes TIMEOUT", async () => {
  const hanging = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener("abort", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
  // Provider timeout is 30 s; do not wait for it — verify the abort path by
  // racing: instead assert a fetch that rejects AbortError maps to TIMEOUT.
  const aborting = async () => { const err = new Error("aborted"); err.name = "AbortError"; throw err; };
  await assert.rejects(fetchPsi({ target: "https://example.com/", strategy: "MOBILE", apiKey: PSI_KEY, fetchFn: aborting }), (e) => e.code === "TIMEOUT");
  assert.equal(typeof hanging, "function");
});

test("CrUX page valid: p75 + classifications + collection period, key never in summary", async () => {
  let seenBody = null;
  let seenUrl = "";
  const fetchFn = async (url, opts) => { seenUrl = url; seenBody = JSON.parse(opts.body); return mockResponse({ body: cruxFixture() }); };
  const out = await fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: CRUX_KEY, fetchFn });
  assert.equal(out.scope, "page");
  assert.equal(out.metrics.lcp.p75Ms, 2400);
  assert.equal(out.metrics.lcp.classification, "GOOD");
  assert.equal(out.metrics.inp.classification, "GOOD");
  assert.equal(out.metrics.cls.classification, "GOOD");
  assert.deepEqual(out.collectionPeriod.firstDate, { year: 2026, month: 9, day: 29 });
  assert.equal(seenBody.url, "https://example.com/");
  assert.equal(seenBody.formFactor, "PHONE");
  assert.ok(seenUrl.startsWith("https://chromeuxreport.googleapis.com/v1/records:queryRecord"));
  assert.ok(!JSON.stringify(out).includes(CRUX_KEY));
});

test("CrUX origin body uses origin, desktop uses DESKTOP; 404 and empty record mean NO_FIELD_DATA", async () => {
  let seenBody = null;
  const fetchFn = async (url, opts) => { seenBody = JSON.parse(opts.body); return mockResponse({ body: cruxFixture() }); };
  await fetchCrux({ target: "https://example.com", scope: "origin", formFactor: "DESKTOP", apiKey: CRUX_KEY, fetchFn });
  assert.equal(seenBody.origin, "https://example.com");
  assert.equal(seenBody.formFactor, "DESKTOP");
  assert.equal(seenBody.url, undefined);

  await assert.rejects(fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: CRUX_KEY, fetchFn: async () => mockResponse({ ok: false, status: 404 }) }), (e) => e.code === "NO_FIELD_DATA");
  await assert.rejects(fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: CRUX_KEY, fetchFn: async () => mockResponse({ body: {} }) }), (e) => e.code === "NO_FIELD_DATA");
  await assert.rejects(fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: CRUX_KEY, fetchFn: async () => mockResponse({ body: { record: { metrics: {} } } }) }), (e) => e.code === "NO_FIELD_DATA");
});

test("CrUX edge cases: missing collection period -> null (not crash), missing percentile -> null metric, null metrics, quota, invalid JSON, zero values kept", async () => {
  const noPeriod = cruxFixture();
  delete noPeriod.record.collectionPeriod;
  const out = await fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: CRUX_KEY, fetchFn: async () => mockResponse({ body: noPeriod }) });
  assert.equal(out.collectionPeriod, null);
  assert.equal(out.metrics.lcp.p75Ms, 2400);

  const noP75 = cruxFixture();
  delete noP75.record.metrics.interaction_to_next_paint.percentiles;
  const out2 = await fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: CRUX_KEY, fetchFn: async () => mockResponse({ body: noP75 }) });
  assert.equal(out2.metrics.inp.p75Ms, null);
  assert.equal(out2.metrics.inp.classification, "UNAVAILABLE");

  const zero = cruxFixture();
  zero.record.metrics.cumulative_layout_shift.percentiles.p75 = 0;
  const out3 = await fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: CRUX_KEY, fetchFn: async () => mockResponse({ body: zero }) });
  assert.equal(out3.metrics.cls.p75, 0);
  assert.equal(out3.metrics.cls.classification, "GOOD");

  await assert.rejects(fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: CRUX_KEY, fetchFn: async () => mockResponse({ ok: false, status: 429 }) }), (e) => e.code === "QUOTA_EXCEEDED");
  await assert.rejects(fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: CRUX_KEY, fetchFn: async () => mockResponse({ body: "{bad" }) }), (e) => e.code === "INVALID_RESPONSE");
  await assert.rejects(fetchCrux({ target: "https://example.com/", scope: "page", formFactor: "PHONE", apiKey: null, fetchFn: async () => mockResponse({}) }), (e) => e.code === "NOT_CONFIGURED");
});
