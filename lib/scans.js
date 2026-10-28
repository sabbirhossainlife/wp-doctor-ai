// Tool 01 scan service (Milestone 3). Owns the Scan lifecycle:
//   RUNNING row -> run the Milestone 2 scanner -> classify -> findings ->
//   terminal row. The finally block guarantees no ordinary error leaves a
//   permanent RUNNING record.
// The scanner is injectable ONLY as a function parameter (default: the real
// scanUrl). There is no env flag, query parameter, or production code path
// that swaps in an unsafe transport. API routes always call with defaults.
// Privacy: only redacted targets are stored (protocol + hostname + path).
// The scanner sends the query string as part of the HTTP request target —
// that is how the URL itself is fetched — but the query is stripped from
// everything stored or logged. Fragments are never sent.
import { prisma } from "./prisma.js";
import { scanUrl, ScanLimiter, redactUrlForLog } from "./scanner/index.js";
import { classifySuccess, classifyError } from "./diagnostics/classify.js";

// Shared in-process limiter so per-user quotas actually accumulate across
// requests in a single-process deployment (see docs: not multi-instance safe).
export const sharedScanLimiter = new ScanLimiter();

export function sanitizeTargetForStorage(input) {
  if (typeof input !== "string") return "[invalid-url]";
  try {
    return redactUrlForLog(input);
  } catch {
    return "[invalid-url]";
  }
}

function toFindingRows(findings) {
  return findings.map((f) => ({
    title: f.title,
    description: f.description,
    severity: f.severity,
    status: f.status,
    evidence: f.evidence ?? {},
    recommendation: f.recommendation ?? null,
  }));
}

export function scanSummary(scan, findings = []) {
  return {
    id: scan.id,
    targetUrl: scan.targetUrl,
    executionStatus: scan.executionStatus,
    diagnosticOutcome: scan.diagnosticOutcome,
    httpStatus: scan.httpStatus,
    durationMs: scan.durationMs,
    redirectCount: scan.redirectCount,
    finalUrl: scan.finalUrl,
    errorCode: scan.errorCode,
    startedAt: scan.startedAt,
    completedAt: scan.completedAt,
    createdAt: scan.createdAt,
    updatedAt: scan.updatedAt,
    findings,
  };
}

// user: { id } from the verified server session — never from request input.
// deps: { scanner, limiter, resolver, transport, ip, logger } — all optional;
//   scanner defaults to the real scanUrl, limiter to the shared limiter.
//   ip defaults to null: no trusted client IP is available in this app, and
//   X-Forwarded-For is never trusted, so per-IP bucketing is inactive unless
//   a caller explicitly passes a trusted IP.
export async function createScan(user, url, deps = {}) {
  const scanner = deps.scanner || scanUrl;
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedScanLimiter;
  const scan = await prisma.scan.create({
    data: {
      userId: user.id,
      targetUrl: sanitizeTargetForStorage(url),
      executionStatus: "RUNNING",
      diagnosticOutcome: "INSUFFICIENT_EVIDENCE",
    },
  });
  let finished = false;
  try {
    const result = await scanner(url, {
      resolver: deps.resolver,
      transport: deps.transport,
      limiter,
      logger: deps.logger,
      userId: user.id,
      ip: deps.ip ?? null,
    });
    const classified = classifySuccess(result);
    const updated = await prisma.scan.update({
      where: { id: scan.id },
      data: {
        executionStatus: classified.executionStatus,
        diagnosticOutcome: classified.diagnosticOutcome,
        httpStatus: result.finalStatus ?? null,
        durationMs: result.durationMs ?? null,
        redirectCount: result.redirectCount ?? null,
        finalUrl: result.finalUrl ?? null,
        errorCode: null,
        completedAt: new Date(),
      },
    });
    await prisma.scanFinding.createMany({ data: toFindingRows(classified.findings).map((f) => ({ ...f, scanId: scan.id })) });
    finished = true;
    const findings = await prisma.scanFinding.findMany({
      where: { scanId: scan.id },
      orderBy: { createdAt: "asc" },
    });
    return { scan: scanSummary(updated, findings), rateLimited: false };
  } catch (error) {
    const code = error?.code && typeof error.code === "string" ? error.code : "INTERNAL_SCANNER_ERROR";
    const classified = classifyError(code);
    const rateLimited = code === "RATE_LIMITED" || code === "CONCURRENCY_LIMIT_REACHED";
    // Persist the failure honestly. If even this update fails, the error
    // propagates and the API reports a save failure — never a saved report.
    const updated = await prisma.scan.update({
      where: { id: scan.id },
      data: {
        executionStatus: classified.executionStatus,
        diagnosticOutcome: classified.diagnosticOutcome,
        httpStatus: null,
        durationMs: null,
        redirectCount: null,
        finalUrl: null,
        errorCode: code,
        completedAt: new Date(),
      },
    });
    await prisma.scanFinding.createMany({ data: toFindingRows(classified.findings).map((f) => ({ ...f, scanId: scan.id })) });
    finished = true;
    const findings = await prisma.scanFinding.findMany({
      where: { scanId: scan.id },
      orderBy: { createdAt: "asc" },
    });
    return { scan: scanSummary(updated, findings), rateLimited };
  } finally {
    if (!finished) {
      // Last-resort guard: never leave a RUNNING record on an unexpected
      // path (e.g. a persistence error after the scan itself finished).
      try {
        await prisma.scan.update({
          where: { id: scan.id },
          data: {
            executionStatus: "FAILED",
            diagnosticOutcome: "INSUFFICIENT_EVIDENCE",
            errorCode: "INTERNAL_SCANNER_ERROR",
            completedAt: new Date(),
          },
        });
      } catch {
        // Nothing further can be done honestly here; the API caller still
        // receives the original error, not a fabricated saved report.
      }
    }
  }
}
