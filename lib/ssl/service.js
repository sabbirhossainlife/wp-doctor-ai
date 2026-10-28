// Tool 06 service (Milestone 10). Synchronous bounded flow: user URL
// (or an owned Website record's stored URL — never client-supplied
// website data) -> SSL/redirect engine (SSRF-safe, pinned,
// redirect-validated) -> deterministic findings -> persisted report.
// Only url + websiteId are ever read from client input; client-supplied
// findings, certificate results, statuses, and ownership fields are
// ignored. No response body, query string, fragment, credential, cookie,
// internal IP, or raw network detail is ever stored.
import { prisma } from "../prisma.js";
import { runSslRedirectCheck } from "./engine.js";
import { sharedSslLimiter } from "./rate-limit.js";

const MAX_URL_LENGTH = 2048;

export class SslError extends Error {
  constructor(code, status, payload = {}) {
    super(code);
    this.name = "SslError";
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

export function publicFinding(row) {
  return {
    id: row.id,
    code: row.code,
    severity: row.severity,
    title: row.title,
    explanation: row.explanation,
    evidence: row.evidence,
    recommendation: row.recommendation,
    confidence: row.confidence,
    limitations: row.limitations,
  };
}

export function sslSummary(diagnostic, findings = []) {
  return {
    id: diagnostic.id,
    websiteId: diagnostic.websiteId ?? null,
    sanitizedTargetUrl: diagnostic.sanitizedTargetUrl,
    executionStatus: diagnostic.executionStatus,
    summary: diagnostic.summary,
    tlsOutcome: diagnostic.tlsOutcome,
    redirectChain: diagnostic.redirectChain,
    limitations: diagnostic.limitations,
    startedAt: diagnostic.startedAt ? diagnostic.startedAt.toISOString() : null,
    completedAt: diagnostic.completedAt ? diagnostic.completedAt.toISOString() : null,
    createdAt: diagnostic.createdAt ? diagnostic.createdAt.toISOString() : null,
    findings,
  };
}

export async function listSslRedirectDiagnostics(userId, { page = 1, pageSize = 20 } = {}) {
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.sslRedirectDiagnostic.count({ where: { userId } }),
    prisma.sslRedirectDiagnostic.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { findings: { orderBy: { createdAt: "asc" } } },
    }),
  ]);
  return { diagnostics: rows.map((d) => sslSummary(d, d.findings.map(publicFinding))), total, page, pageSize: take };
}

export async function getSslRedirectDiagnostic(userId, id) {
  const diagnostic = await prisma.sslRedirectDiagnostic.findFirst({
    where: { id, userId },
    include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
  });
  return diagnostic;
}

export async function createSslRedirectDiagnostic(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedSslLimiter;
  if (limiter && !limiter.check(userId)) {
    throw new SslError("RATE_LIMITED", 429);
  }
  const websiteId = typeof input?.websiteId === "string" && input.websiteId.trim() !== "" ? input.websiteId.trim() : null;
  let url = typeof input?.url === "string" ? input.url.trim() : "";
  let website = null;
  if (websiteId) {
    // Ownership enforced in the query; the URL comes ONLY from the
    // owned record. A client-supplied url alongside websiteId is ignored.
    website = await prisma.website.findFirst({ where: { id: websiteId, userId } });
    if (!website) throw new SslError("WEBSITE_NOT_FOUND", 404);
    url = website.normalizedUrl;
  }
  const errors = {};
  if (!url || url.length > MAX_URL_LENGTH) errors.url = "A URL of 2048 characters or fewer is required.";
  if (Object.keys(errors).length > 0) throw new SslError("VALIDATION_FAILED", 400, { errors });

  const engine = deps.engine ?? runSslRedirectCheck;
  let result;
  try {
    result = await engine(url, deps.engineDeps ?? {});
  } catch {
    // An engine crash must not leak internals; persist a FAILED report
    // with no invented evidence instead.
    result = {
      sanitizedTargetUrl: url,
      executionStatus: "FAILED",
      terminalReason: "INTERNAL_ERROR",
      errorCode: "INTERNAL_SCANNER_ERROR",
      chain: [],
      tlsOutcome: null,
      summary: { certStatus: "UNKNOWN", finalUrl: null, finalStatus: null, redirectCount: 0, crossHost: false, downgradeBlocked: false, terminalReason: "INTERNAL_ERROR", errorCode: "INTERNAL_SCANNER_ERROR" },
      limitations: ["The check failed before any evidence could be gathered."],
      findings: [{ code: "INCOMPLETE_EVIDENCE", severity: "MEDIUM", title: "Evidence is incomplete", explanation: "The check could not gather enough evidence to draw a conclusion.", evidence: {}, recommendation: "Re-run the check.", confidence: "MEDIUM", limitations: null }],
    };
  }

  try {
    const diagnostic = await prisma.$transaction(async (tx) => {
      const created = await tx.sslRedirectDiagnostic.create({
        data: {
          userId,
          websiteId: website ? website.id : null,
          sanitizedTargetUrl: result.sanitizedTargetUrl,
          executionStatus: result.executionStatus,
          summary: result.summary,
          tlsOutcome: result.tlsOutcome,
          redirectChain: result.chain,
          limitations: result.limitations,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      if (result.findings.length > 0) {
        await tx.sslRedirectFinding.createMany({
          data: result.findings.map((f) => ({
            diagnosticId: created.id,
            code: f.code,
            severity: f.severity,
            title: f.title,
            explanation: f.explanation,
            evidence: f.evidence ?? {},
            recommendation: f.recommendation,
            confidence: f.confidence,
            limitations: f.limitations ?? null,
          })),
        });
      }
      return created;
    });
    const rows = await prisma.sslRedirectFinding.findMany({
      where: { diagnosticId: diagnostic.id },
      orderBy: { createdAt: "asc" },
    });
    return sslSummary(diagnostic, rows.map(publicFinding));
  } catch {
    throw new SslError("DATABASE_OPERATION_FAILED", 500);
  }
}
