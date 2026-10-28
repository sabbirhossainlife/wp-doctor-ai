// AI analysis service + DB tests. Run via: npm run test:db (which sets
// DATABASE_URL to the dedicated test database). Skipped without a DB URL.
// Uses a mock provider only — no live provider calls, no real API key.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { generateAiAnalysis } from "../lib/ai/analyze.js";
import { MockProvider, AiProviderError } from "../lib/ai/providers.js";
import { AiRateLimiter } from "../lib/ai/rate-limit.js";
import { validAnalysis } from "./ai-fixture.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
let n = 0;

async function makeScan(userId, findingId = null) {
  n += 1;
  const scan = await prisma.scan.create({
    data: {
      userId,
      targetUrl: "https://example.com/page",
      executionStatus: "COMPLETED",
      diagnosticOutcome: "HTTP_ERROR_RESPONSE",
      httpStatus: 500,
      durationMs: 42,
      redirectCount: 0,
      finalUrl: "https://example.com/page",
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  const finding = await prisma.scanFinding.create({
    data: {
      scanId: scan.id,
      title: "Server error",
      description: "The server returned HTTP 500.",
      severity: "high",
      status: "confirmed",
      evidence: {},
      recommendation: "Check the error log.",
    },
  });
  return { scan, finding, findingId: findingId || finding.id };
}

async function makeUser() {
  n += 1;
  return prisma.user.create({
    data: { name: `AI Test ${n}`, email: `ai-${stamp}-${n}@example.com`, role: "USER" },
  });
}

test("service persists a valid analysis and leaves findings unchanged", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => prisma.user.deleteMany({ where: { id: user.id } }));
  const { scan, finding } = await makeScan(user.id);
  const mock = new MockProvider({ analysis: validAnalysis(finding.id) });
  const result = await generateAiAnalysis({
    prisma, scan, findings: [finding], userId: user.id, providerOverride: mock,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.analysis.schemaVersion, "1");
  assert.equal(mock.calls, 1);
  const row = await prisma.aiAnalysis.findUnique({ where: { scanId: scan.id } });
  assert.equal(row.status, "COMPLETED");
  assert.equal(row.analysis.summary, validAnalysis(finding.id).summary);
  const findingsAfter = await prisma.scanFinding.findMany({ where: { scanId: scan.id } });
  assert.equal(findingsAfter.length, 1);
  assert.equal(findingsAfter[0].description, "The server returned HTTP 500.");
  const scanAfter = await prisma.scan.findUnique({ where: { id: scan.id } });
  assert.equal(scanAfter.diagnosticOutcome, "HTTP_ERROR_RESPONSE");
});

test("duplicate requests return the cached analysis without a second provider call", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => prisma.user.deleteMany({ where: { id: user.id } }));
  const { scan, finding } = await makeScan(user.id);
  const mock = new MockProvider({ analysis: validAnalysis(finding.id) });
  const first = await generateAiAnalysis({ prisma, scan, findings: [finding], userId: user.id, providerOverride: mock });
  assert.equal(first.fromCache, false);
  const second = await generateAiAnalysis({ prisma, scan, findings: [finding], userId: user.id, providerOverride: mock });
  assert.equal(second.fromCache, true);
  assert.equal(mock.calls, 1);
  const third = await generateAiAnalysis({ prisma, scan, findings: [finding], userId: user.id, regenerate: true, providerOverride: mock });
  assert.equal(third.fromCache, false);
  assert.equal(mock.calls, 2);
});

test("provider failure persists a FAILED row and a later retry succeeds", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => prisma.user.deleteMany({ where: { id: user.id } }));
  const { scan, finding } = await makeScan(user.id);
  const failing = new MockProvider({ behavior: "timeout" });
  await assert.rejects(
    () => generateAiAnalysis({ prisma, scan, findings: [finding], userId: user.id, providerOverride: failing }),
    (e) => e instanceof AiProviderError && e.code === "PROVIDER_TIMEOUT",
  );
  let row = await prisma.aiAnalysis.findUnique({ where: { scanId: scan.id } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.errorCode, "PROVIDER_TIMEOUT");
  assert.equal(row.analysis, null);
  const ok = new MockProvider({ analysis: validAnalysis(finding.id) });
  const result = await generateAiAnalysis({ prisma, scan, findings: [finding], userId: user.id, providerOverride: ok });
  assert.equal(result.status, "COMPLETED");
  row = await prisma.aiAnalysis.findUnique({ where: { scanId: scan.id } });
  assert.equal(row.status, "COMPLETED");
});

test("invalid provider output is never persisted as a success", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => prisma.user.deleteMany({ where: { id: user.id } }));
  const { scan, finding } = await makeScan(user.id);
  const bad = validAnalysis(finding.id);
  bad.confirmedObservations[0].findingId = "ghost";
  const mock = new MockProvider({ analysis: bad });
  await assert.rejects(
    () => generateAiAnalysis({ prisma, scan, findings: [finding], userId: user.id, providerOverride: mock }),
    (e) => e.code === "INVALID_OUTPUT",
  );
  const row = await prisma.aiAnalysis.findUnique({ where: { scanId: scan.id } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.errorCode, "INVALID_OUTPUT");
  assert.equal(row.analysis, null);
});

test("per-user rate limit blocks excess generations", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => prisma.user.deleteMany({ where: { id: user.id } }));
  const { scan, finding } = await makeScan(user.id);
  const limiter = new AiRateLimiter({ limitPerDay: 1 });
  const mock = new MockProvider({ analysis: validAnalysis(finding.id) });
  await generateAiAnalysis({ prisma, scan, findings: [finding], userId: user.id, providerOverride: mock, limiter });
  await assert.rejects(
    () => generateAiAnalysis({ prisma, scan, findings: [finding], userId: user.id, regenerate: true, providerOverride: mock, limiter }),
    (e) => e.code === "RATE_LIMITED",
  );
});

test("deleting a user cascades to its AI analysis", { skip: !hasDb }, async () => {
  const user = await makeUser();
  const { scan, finding } = await makeScan(user.id);
  const mock = new MockProvider({ analysis: validAnalysis(finding.id) });
  await generateAiAnalysis({ prisma, scan, findings: [finding], userId: user.id, providerOverride: mock });
  await prisma.user.delete({ where: { id: user.id } });
  const row = await prisma.aiAnalysis.findUnique({ where: { scanId: scan.id } });
  assert.equal(row, null);
});
