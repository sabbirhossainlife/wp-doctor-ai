// Tool 05 DB tests (group G). Run via scripts/run-db-tests.mjs with
// TEST_DATABASE_URL. Providers and preflight are injected mocks — no live
// Google call and no real network fetch. Scanner policy cases use real
// ScannerError codes through the injected preflight seam.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { createSpeedDiagnostic, SpeedError } from "../lib/speed/service.js";
import { generateSpeedAiAnalysis } from "../lib/speed/ai.js";
import { MockProvider } from "../lib/ai/providers.js";
import { buildSpeedAiMessages } from "../lib/speed/ai-prompt.js";
import { ScannerError } from "../lib/scanner/index.js";
import { SpeedRateLimiter } from "../lib/speed/rate-limit.js";
import { AiRateLimiter } from "../lib/ai/rate-limit.js";

const RUN = `sp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA, userB;

function psiBody() {
  return {
    lighthouseResult: {
      categories: { performance: { score: 0.6 } },
      finalUrl: "https://example.com/",
      fetchTime: "2026-10-27T00:00:00.000Z",
      audits: {
        "largest-contentful-paint": { title: "Largest Contentful Paint", score: 0.4, displayValue: "4.5 s", numericValue: 4500, numericUnit: "millisecond" },
        "total-blocking-time": { title: "Total Blocking Time", score: 0.6, displayValue: "300 ms", numericValue: 300, numericUnit: "millisecond" },
        "cumulative-layout-shift": { title: "Cumulative Layout Shift", score: 0.9, displayValue: "0.05", numericValue: 0.05, numericUnit: "unitless" },
        "render-blocking-resources": { title: "Eliminate render-blocking resources", score: 0.5, displayValue: "Potential savings of 400 ms", numericValue: 400, numericUnit: "millisecond", details: { overallSavingsMs: 400 } },
      },
    },
  };
}
function cruxBody() {
  return {
    record: {
      key: { url: "https://example.com/" },
      metrics: {
        largest_contentful_paint: { percentiles: { p75: 2600 }, histogram: [{ start: 0, end: 2500, density: 0.5 }, { start: 2500, end: 4000, density: 0.4 }, { start: 4000, density: 0.1 }] },
        interaction_to_next_paint: { percentiles: { p75: 150 }, histogram: [{ start: 0, end: 200, density: 0.8 }, { start: 200, end: 500, density: 0.15 }, { start: 500, density: 0.05 }] },
        cumulative_layout_shift: { percentiles: { p75: 0.04 }, histogram: [{ start: 0, end: 0.1, density: 0.9 }, { start: 0.1, end: 0.25, density: 0.08 }, { start: 0.25, density: 0.02 }] },
      },
      collectionPeriod: { firstDate: { year: 2026, month: 9, day: 29 }, lastDate: { year: 2026, month: 10, day: 26 } },
    },
  };
}
function mockFetchFor({ cruxMode = "page" } = {}) {
  const seen = [];
  const fn = async (url, opts = {}) => {
    seen.push(url);
    if (url.includes("pagespeedonline")) {
      return { ok: true, status: 200, text: async () => JSON.stringify(psiBody()) };
    }
    if (url.includes("chromeuxreport")) {
      const body = JSON.parse(opts.body || "{}");
      if (cruxMode === "page-missing-origin-ok" && body.url) {
        return { ok: false, status: 404, text: async () => "{}" };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(cruxBody()) };
    }
    throw new Error(`unexpected provider url ${url}`);
  };
  fn.seen = seen;
  return fn;
}
const preflightOk = async () => ({
  ok: true, finalUrl: "https://example.com/", finalStatus: 200, redirectCount: 0,
  chain: [{ url: "https://example.com/", status: 200 }], durationMs: 420,
});
const envWithKeys = { GOOGLE_PAGESPEED_API_KEY: "test-psi", GOOGLE_CRUX_API_KEY: "test-crux" };

test("db setup: users", async () => {
  userA = await prisma.user.create({ data: { name: "Speed A", email: `${RUN}-a@example.invalid` } });
  userB = await prisma.user.create({ data: { name: "Speed B", email: `${RUN}-b@example.invalid` } });
  assert.ok(userA.id && userB.id);
});

test("creation COMPLETED with lab+field findings; query stripped from provider target and storage; no key stored", async () => {
  const fetchFn = mockFetchFor();
  const d = await createSpeedDiagnostic(userA.id, { url: "https://example.com/?token=secret-value&x=1#section", strategy: "MOBILE" }, { preflight: preflightOk, fetchFn, env: envWithKeys, limiter: new SpeedRateLimiter() });
  assert.equal(d.status, "COMPLETED");
  assert.equal(d.providerTarget, "https://example.com/");
  assert.equal(d.queryStripped, true);
  assert.ok(!d.requestedTarget.includes("token"));
  assert.ok(!d.requestedTarget.includes("secret-value"));
  assert.ok(!JSON.stringify(d).includes("test-psi"));
  assert.ok(!JSON.stringify(d).includes("test-crux"));
  assert.equal(d.lighthouseSummary.score100, 60);
  assert.equal(d.cruxSummary.scope, "page");
  assert.ok(d.findings.some((f) => f.category === "HIGH_LCP" && f.source === "LIGHTHOUSE"));
  assert.ok(d.findings.some((f) => f.category === "RENDER_BLOCKING_RESOURCE"));
  // Provider fetch received the stripped target, never the query.
  assert.ok(fetchFn.seen.every((u) => !u.includes("token") && !u.includes("secret-value")));
  // Stored rows match the returned summary.
  const row = await prisma.speedDiagnostic.findUnique({ where: { id: d.id }, include: { findings: true } });
  assert.equal(row.findings.length, d.findings.length);
  assert.equal(row.userId, userA.id);
});

test("duplicate submit within window returns the recent report instead of re-running", async () => {
  const fetchFn = mockFetchFor();
  const first = await createSpeedDiagnostic(userA.id, { url: "https://example.com/dup", strategy: "DESKTOP" }, { preflight: async () => ({ ...await preflightOk(), finalUrl: "https://example.com/dup" }), fetchFn, env: envWithKeys, limiter: new SpeedRateLimiter() });
  const callsAfterFirst = fetchFn.seen.length;
  const second = await createSpeedDiagnostic(userA.id, { url: "https://example.com/dup", strategy: "DESKTOP" }, { preflight: async () => { throw new Error("must not run"); }, fetchFn, env: envWithKeys, limiter: new SpeedRateLimiter() });
  assert.equal(second.duplicateOfRecent, true);
  assert.equal(second.id, first.id);
  assert.equal(fetchFn.seen.length, callsAfterFirst);
});

test("origin fallback: page missing, origin record stored with scope=origin and OK_ORIGIN_FALLBACK", async () => {
  const fetchFn = mockFetchFor({ cruxMode: "page-missing-origin-ok" });
  const d = await createSpeedDiagnostic(userA.id, { url: "https://example.com/origin-fallback", strategy: "MOBILE" }, { preflight: async () => ({ ...await preflightOk(), finalUrl: "https://example.com/origin-fallback" }), fetchFn, env: envWithKeys, limiter: new SpeedRateLimiter() });
  // Origin fallback is a successful (explicitly labelled) field result, so
  // the report is COMPLETED, not PARTIAL — PARTIAL is for failed/missing sources.
  assert.equal(d.status, "COMPLETED");
  assert.equal(d.cruxSummary.scope, "origin");
  assert.equal(d.providerStatuses.crux, "OK_ORIGIN_FALLBACK");
});

test("partial when providers unconfigured: HTTP-only report persists, statuses NOT_CONFIGURED", async () => {
  const d = await createSpeedDiagnostic(userA.id, { url: "https://example.com/no-providers", strategy: "MOBILE" }, { preflight: async () => ({ ...await preflightOk(), finalUrl: "https://example.com/no-providers" }), fetchFn: async () => { throw new Error("must not be called"); }, env: {}, limiter: new SpeedRateLimiter() });
  assert.equal(d.status, "PARTIAL");
  assert.equal(d.lighthouseSummary, null);
  assert.equal(d.cruxSummary, null);
  assert.equal(d.providerStatuses.psi, "NOT_CONFIGURED");
  assert.equal(d.providerStatuses.crux, "NOT_CONFIGURED");
});

test("BLOCKED preflight persists a BLOCKED report with no provider calls; FAILED persists a FAILED report", async () => {
  const blocked = await createSpeedDiagnostic(userA.id, { url: "https://example.com/blocked-case", strategy: "MOBILE" }, { preflight: async () => { throw new ScannerError("PROHIBITED_DESTINATION", "test"); }, fetchFn: async () => { throw new Error("must not be called"); }, env: envWithKeys, limiter: new SpeedRateLimiter() });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.httpSummary.errorCode, "PROHIBITED_DESTINATION");
  const failed = await createSpeedDiagnostic(userA.id, { url: "https://example.com/failed-case", strategy: "MOBILE" }, { preflight: async () => { throw new ScannerError("DNS_FAILURE", "test"); }, fetchFn: async () => { throw new Error("must not be called"); }, env: envWithKeys, limiter: new SpeedRateLimiter() });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.httpSummary.errorCode, "DNS_FAILURE");
});

test("validation and rate limit: bad strategy 400, limiter 429", async () => {
  await assert.rejects(
    createSpeedDiagnostic(userA.id, { url: "https://example.com/", strategy: "TABLET" }, { preflight: preflightOk, fetchFn: mockFetchFor(), env: envWithKeys, limiter: new SpeedRateLimiter() }),
    (e) => e instanceof SpeedError && e.status === 400,
  );
  const limiter = new SpeedRateLimiter({ limitPerHour: 1 });
  await createSpeedDiagnostic(userA.id, { url: "https://example.com/rate-1", strategy: "MOBILE" }, { preflight: async () => ({ ...await preflightOk(), finalUrl: "https://example.com/rate-1" }), fetchFn: mockFetchFor(), env: {}, limiter });
  await assert.rejects(
    createSpeedDiagnostic(userA.id, { url: "https://example.com/rate-2", strategy: "MOBILE" }, { preflight: preflightOk, fetchFn: mockFetchFor(), env: {}, limiter }),
    (e) => e instanceof SpeedError && e.status === 429,
  );
});

test("ownership + history pagination: user B cannot see user A reports via WHERE; AI mock analysis persists and regenerates", async () => {
  const mine = await prisma.speedDiagnostic.findMany({ where: { userId: userA.id }, orderBy: { createdAt: "desc" }, take: 2 });
  assert.ok(mine.length >= 2);
  const other = await prisma.speedDiagnostic.findFirst({ where: { id: mine[0].id, userId: userB.id } });
  assert.equal(other, null);

  const target = mine.find((m) => m.status === "COMPLETED") ?? mine[0];
  const diagnostic = await prisma.speedDiagnostic.findUnique({ where: { id: target.id }, include: { findings: true } });
  const analysis = {
    schemaVersion: "speed-1",
    summary: "Lab LCP is slow; field data is labelled separately.",
    explanation: "The lab run measured slow LCP while field p75 values are shown in their own section.",
    diagnosticConfidence: "MEDIUM",
    confirmedObservations: diagnostic.findings.length > 0 ? [{ findingId: diagnostic.findings[0].id, observation: "A deterministic finding exists." }] : [],
    causeHypotheses: [],
    recommendedActions: [{ title: "Defer non-critical scripts", description: "Test on staging first.", priority: "MEDIUM" }],
    missingEvidence: [],
    limitations: ["Lab and field windows differ."],
    humanReviewRecommended: false,
  };
  const provider = new MockProvider({ analysis, messagesBuilder: buildSpeedAiMessages });
  const first = await generateSpeedAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, providerOverride: provider, limiter: new AiRateLimiter({ limitPerDay: 100 }) });
  assert.equal(first.status, "COMPLETED");
  assert.equal(first.fromCache, false);
  const second = await generateSpeedAiAnalysis({ diagnostic, findings: diagnostic.findings, userId: userA.id, providerOverride: provider, limiter: new AiRateLimiter({ limitPerDay: 100 }) });
  assert.equal(second.fromCache, true);
  // Deterministic findings untouched by AI.
  const after = await prisma.speedDiagnosticFinding.count({ where: { diagnosticId: target.id } });
  assert.equal(after, diagnostic.findings.length);
});
