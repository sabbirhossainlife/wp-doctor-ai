// Tool 01 service + DB tests. Run via: npm run test:db (which sets
// DATABASE_URL to the dedicated test database). Skipped without a DB URL.
// Uses the REAL Milestone 2 scanUrl with injected resolver/transport doubles
// from tests/scanner-helpers.js for the SSRF integration path, plus fake
// scanner functions for classification/persistence paths.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { createScan, sanitizeTargetForStorage } from "../lib/scans.js";
import { scanUrl, ScanLimiter, ScannerError } from "../lib/scanner/index.js";
import { makeResolver, makeTransport, PUBLIC_V4 } from "./scanner-helpers.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
let n = 0;

async function makeUser() {
  n += 1;
  return prisma.user.create({
    data: { name: `Scan Test ${n}`, email: `scan-${stamp}-${n}@example.com`, role: "USER" },
  });
}

async function cleanup(userIds) {
  // Cascade deletes scans + findings via the user relation.
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test("sanitizeTargetForStorage strips query, fragment, and credentials", { skip: !hasDb }, () => {
  assert.equal(
    sanitizeTargetForStorage("https://user:pass@example.com/path/page?token=secret#section"),
    "https://example.com/path/page",
  );
  assert.equal(sanitizeTargetForStorage("not a url"), "[invalid-url]");
});

test("service persists a successful 200 scan with findings and no RUNNING row", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => cleanup([user.id]));
  const fakeScanner = async () => ({
    ok: true,
    finalUrl: "https://example.com/",
    finalStatus: 200,
    redirectCount: 0,
    chain: [{ url: "https://example.com/", protocol: "https:", status: 200, contentType: "text/html", bodyBytes: 10 }],
    durationMs: 42,
  });
  const { scan, rateLimited } = await createScan(user, "https://example.com/?secret=abc#frag", { scanner: fakeScanner, limiter: null });
  assert.equal(rateLimited, false);
  assert.equal(scan.executionStatus, "COMPLETED");
  assert.equal(scan.diagnosticOutcome, "REACHABLE");
  assert.equal(scan.httpStatus, 200);
  assert.equal(scan.targetUrl, "https://example.com/");
  assert.ok(!JSON.stringify(scan).includes("secret=abc"), "query must never appear in stored output");
  assert.equal(scan.findings.length, 1);
  const row = await prisma.scan.findUnique({ where: { id: scan.id } });
  assert.equal(row.executionStatus, "COMPLETED");
  assert.ok(row.completedAt);
});

test("service persists a 500 scan as completed with an error finding", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => cleanup([user.id]));
  const fakeScanner = async () => ({
    ok: true,
    finalUrl: "https://example.com/",
    finalStatus: 500,
    redirectCount: 0,
    chain: [{ url: "https://example.com/", protocol: "https:", status: 500, contentType: "text/html", bodyBytes: 10 }],
    durationMs: 42,
  });
  const { scan } = await createScan(user, "https://example.com/", { scanner: fakeScanner, limiter: null });
  assert.equal(scan.executionStatus, "COMPLETED");
  assert.equal(scan.diagnosticOutcome, "HTTP_ERROR_RESPONSE");
  assert.match(scan.findings[0].title, /500/);
});

test("service persists a blocked scan and a non-ScannerError as INTERNAL", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => cleanup([user.id]));
  const blocked = async () => { throw new ScannerError("PROHIBITED_DESTINATION", "test"); };
  const r1 = await createScan(user, "http://127.0.0.1/", { scanner: blocked, limiter: null });
  assert.equal(r1.scan.executionStatus, "BLOCKED");
  assert.equal(r1.scan.diagnosticOutcome, "BLOCKED_BY_SECURITY_POLICY");
  assert.equal(r1.scan.errorCode, "PROHIBITED_DESTINATION");
  const weird = async () => { throw new Error("boom"); };
  const r2 = await createScan(user, "https://example.com/", { scanner: weird, limiter: null });
  assert.equal(r2.scan.executionStatus, "FAILED");
  assert.equal(r2.scan.errorCode, "INTERNAL_SCANNER_ERROR");
  const running = await prisma.scan.count({ where: { userId: user.id, executionStatus: "RUNNING" } });
  assert.equal(running, 0, "no scan may remain RUNNING after ordinary errors");
});

test("SSRF integration: real scanUrl rejects prohibited targets with 0 transport calls", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => cleanup([user.id]));
  const cases = [
    ["http://127.0.0.1/", "loopback"],
    ["http://10.0.0.5/admin", "private IPv4"],
    ["http://[::1]/", "IPv6 loopback"],
    ["http://169.254.169.254/latest/meta-data/", "link-local metadata"],
    ["ftp://example.com/", "unsupported scheme"],
    ["https://user:pass@example.com/", "embedded credentials"],
    ["https://example.com:8443/", "unsupported port"],
  ];
  for (const [url, label] of cases) {
    const transport = makeTransport({});
    const resolver = makeResolver({ "example.com": { v4: [PUBLIC_V4], v6: [] } });
    const { scan } = await createScan(user, url, {
      scanner: scanUrl,
      resolver,
      transport,
      limiter: null,
    });
    assert.equal(scan.executionStatus, "BLOCKED", label);
    assert.equal(transport.calls.length, 0, `${label}: prohibited target must never reach transport`);
  }
});

test("SSRF integration: mixed DNS answers and redirect-to-private are rejected", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => cleanup([user.id]));
  const mixedResolver = makeResolver({
    "mixed.example.com": { v4: [PUBLIC_V4, "10.1.2.3"], v6: [] },
  });
  const transport = makeTransport({});
  const r1 = await createScan(user, "https://mixed.example.com/", {
    scanner: scanUrl, resolver: mixedResolver, transport, limiter: null,
  });
  assert.equal(r1.scan.diagnosticOutcome, "BLOCKED_BY_SECURITY_POLICY");
  assert.equal(transport.calls.length, 0, "mixed DNS must not reach transport");

  const redirectTransport = makeTransport({
    "ok.example.com": { status: 302, headers: { location: "http://127.0.0.1/" }, bodyBytes: 0 },
  });
  const okResolver = makeResolver({ "ok.example.com": { v4: [PUBLIC_V4], v6: [] } });
  const r2 = await createScan(user, "https://ok.example.com/", {
    scanner: scanUrl, resolver: okResolver, transport: redirectTransport, limiter: null,
  });
  assert.equal(r2.scan.diagnosticOutcome, "BLOCKED_BY_SECURITY_POLICY");
  assert.equal(redirectTransport.calls.length, 1, "only the public hop may reach transport");
});

test("SSRF integration: redirect loop and HTTPS downgrade are rejected", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => cleanup([user.id]));
  const loopTransport = makeTransport({
    "loop.example.com": { status: 302, headers: { location: "https://loop.example.com/" }, bodyBytes: 0 },
  });
  const resolver = makeResolver({ "loop.example.com": { v4: [PUBLIC_V4], v6: [] } });
  const r1 = await createScan(user, "https://loop.example.com/", {
    scanner: scanUrl, resolver, transport: loopTransport, limiter: null,
  });
  assert.equal(r1.scan.diagnosticOutcome, "REDIRECT_PROBLEM");

  const downgradeTransport = makeTransport({
    "secure.example.com": { status: 302, headers: { location: "http://secure.example.com/" }, bodyBytes: 0 },
  });
  const downgradeResolver = makeResolver({ "secure.example.com": { v4: [PUBLIC_V4], v6: [] } });
  const r2 = await createScan(user, "https://secure.example.com/", {
    scanner: scanUrl, resolver: downgradeResolver, transport: downgradeTransport, limiter: null,
  });
  assert.equal(r2.scan.diagnosticOutcome, "BLOCKED_BY_SECURITY_POLICY");
});

test("service rate limit persists a 429-classified scan", { skip: !hasDb }, async (t) => {
  const user = await makeUser();
  t.after(() => cleanup([user.id]));
  const limiter = new ScanLimiter({ perUserPerMinute: 1, perIpPerMinute: 1000, maxConcurrent: 5 });
  const fakeScanner = async () => ({
    ok: true, finalUrl: "https://example.com/", finalStatus: 200, redirectCount: 0,
    chain: [{ url: "https://example.com/", protocol: "https:", status: 200, contentType: null, bodyBytes: 0 }],
    durationMs: 1,
  });
  // First scan consumes the per-user bucket; the real scanUrl path is used
  // here (not the fake scanner) so the limiter actually runs.
  const okTransport = makeTransport({});
  const resolver = makeResolver({ "example.com": { v4: [PUBLIC_V4], v6: [] } });
  const first = await createScan(user, "https://example.com/", {
    scanner: scanUrl, resolver, transport: okTransport, limiter,
  });
  assert.equal(first.scan.executionStatus, "COMPLETED");
  const second = await createScan(user, "https://example.com/", {
    scanner: scanUrl, resolver, transport: okTransport, limiter,
  });
  assert.equal(second.rateLimited, true);
  assert.equal(second.scan.errorCode, "RATE_LIMITED");
  assert.equal(second.scan.diagnosticOutcome, "INSUFFICIENT_EVIDENCE");
});

test("history query returns only the owner's scans, newest first", { skip: !hasDb }, async (t) => {
  const userA = await makeUser();
  const userB = await makeUser();
  t.after(() => cleanup([userA.id, userB.id]));
  const fakeScanner = async () => ({
    ok: true, finalUrl: "https://example.com/", finalStatus: 200, redirectCount: 0,
    chain: [{ url: "https://example.com/", protocol: "https:", status: 200, contentType: null, bodyBytes: 0 }],
    durationMs: 1,
  });
  await createScan(userA, "https://example.com/a", { scanner: fakeScanner, limiter: null });
  await createScan(userB, "https://example.com/b", { scanner: fakeScanner, limiter: null });
  const mine = await prisma.scan.findMany({ where: { userId: userA.id }, orderBy: { createdAt: "desc" } });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].targetUrl, "https://example.com/a");
  const other = await prisma.scan.findFirst({ where: { id: mine[0].id, userId: userB.id } });
  assert.equal(other, null, "ownership-scoped query must not return another user's scan");
  // User delete cascades to scans + findings.
  const scanId = mine[0].id;
  await prisma.user.delete({ where: { id: userA.id } });
  assert.equal(await prisma.scan.findUnique({ where: { id: scanId } }), null);
  assert.equal(await prisma.scanFinding.count({ where: { scanId } }), 0);
  t.after(() => cleanup([userB.id]));
});
