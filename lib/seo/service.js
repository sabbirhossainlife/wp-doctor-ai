// Tool 11 service (Milestone 15). Synchronous bounded flow:
// session user -> (owned Website record + fresh snapshot) OR a bare URL
// -> pinned passive checks (homepage head, robots.txt, sitemaps) ->
// deterministic rules -> persisted report. ONLY websiteId and url are
// read from client input; a client-supplied url alongside websiteId is
// ignored (the URL comes ONLY from the owned record), and client-supplied
// inventory, versions, findings, severities, or SEO status are ignored
// or rejected. There is NO cleanup, deletion, robots.txt edit, metadata
// edit, redirect change, settings change, form-submit, or mutation path
// at all — by construction there is no such function to call. Never
// stored: HTML bodies, matched code snippets, secrets, credentials,
// absolute paths, query strings, fragments, internal IPs, or any
// client-supplied data.
import { prisma } from "../prisma.js";
import { runSeoCheck } from "./engine.js";
import { seoSnapshotFreshness, RESYNC_INSTRUCTIONS } from "./freshness.js";
import { sharedSeoLimiter } from "./rate-limit.js";
import { validateSnapshot } from "../connector/validate-snapshot.js";

const MAX_URL_LENGTH = 2048;

export class SeoError extends Error {
  constructor(code, status, payload = {}) {
    super(code);
    this.name = "SeoError";
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
    evidenceStatus: row.evidenceStatus ?? null,
    limitations: row.limitations ?? null,
    checkId: row.checkId ?? null,
    evidenceCategory: row.evidenceCategory ?? null,
  };
}

export function seoSummary(diagnostic, findings = [], aiAnalysis = null) {
  return {
    id: diagnostic.id,
    websiteId: diagnostic.websiteId ?? null,
    sanitizedWebsiteUrl: diagnostic.sanitizedWebsiteUrl,
    requestedTarget: diagnostic.requestedTarget,
    finalUrl: diagnostic.finalUrl,
    executionStatus: diagnostic.executionStatus,
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    snapshotReceivedAt: diagnostic.snapshotReceivedAt ? diagnostic.snapshotReceivedAt.toISOString() : null,
    snapshotFreshness: diagnostic.snapshotFreshness,
    homepageSummary: diagnostic.homepageSummary,
    robotsSummary: diagnostic.robotsSummary,
    sitemapSummary: diagnostic.sitemapSummary,
    spamSignals: diagnostic.spamSignals,
    seoPluginSummary: diagnostic.seoPluginSummary,
    advisoryContext: diagnostic.advisoryContext,
    searchConsoleStatus: diagnostic.searchConsoleStatus,
    summary: diagnostic.summary,
    limitations: diagnostic.limitations,
    startedAt: diagnostic.startedAt ? diagnostic.startedAt.toISOString() : null,
    completedAt: diagnostic.completedAt ? diagnostic.completedAt.toISOString() : null,
    createdAt: diagnostic.createdAt ? diagnostic.createdAt.toISOString() : null,
    findings,
    aiAnalysis: aiAnalysis ? {
      id: aiAnalysis.id, status: aiAnalysis.status, provider: aiAnalysis.provider, model: aiAnalysis.model,
      schemaVersion: aiAnalysis.schemaVersion, analysis: aiAnalysis.analysis, errorCode: aiAnalysis.errorCode,
      completedAt: aiAnalysis.completedAt ? aiAnalysis.completedAt.toISOString() : null,
    } : null,
  };
}

export async function listSeoDiagnostics(userId, { page = 1, pageSize = 20 } = {}) {
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.seoDiagnostic.count({ where: { userId } }),
    prisma.seoDiagnostic.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip, take,
      include: { findings: { orderBy: { createdAt: "asc" } } },
    }),
  ]);
  return { diagnostics: rows.map((d) => seoSummary(d, d.findings.map(publicFinding))), total, page, pageSize: take };
}

export async function getSeoDiagnostic(userId, id) {
  return prisma.seoDiagnostic.findFirst({
    where: { id, userId },
    include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
  });
}

function sanitizeWebsiteUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export async function createSeoDiagnostic(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedSeoLimiter;
  if (limiter && !limiter.check(userId)) {
    throw new SeoError("RATE_LIMITED", 429);
  }
  const websiteId = typeof input?.websiteId === "string" && input.websiteId.trim() !== "" ? input.websiteId.trim() : null;
  let url = typeof input?.url === "string" ? input.url.trim() : "";
  let website = null;
  let snapshot = null;
  let snapshotRow = null;
  let snapshotFreshness = "NOT_APPLICABLE";
  if (websiteId) {
    // Ownership enforced in the query; the URL comes ONLY from the owned
    // record. A client-supplied url alongside websiteId is ignored.
    website = await prisma.website.findFirst({ where: { id: websiteId, userId }, include: { connection: true } });
    if (!website) throw new SeoError("WEBSITE_NOT_FOUND", 404);
    const connection = website.connection;
    if (!connection || connection.status !== "ACTIVE" || website.connectionStatus !== "CONNECTED") {
      throw new SeoError("SNAPSHOT_MISSING", 422, { snapshotStatus: "SNAPSHOT_MISSING", resyncInstructions: RESYNC_INSTRUCTIONS });
    }
    snapshotRow = await prisma.connectorDiagnosticSnapshot.findFirst({
      where: { connectionId: connection.id },
      orderBy: { receivedAt: "desc" },
    });
    const freshness = seoSnapshotFreshness(snapshotRow, { nowMs: deps.nowMs ?? Date.now() });
    if (freshness.status !== "CURRENT") {
      throw new SeoError(freshness.status, 422, { snapshotStatus: freshness.status, resyncInstructions: RESYNC_INSTRUCTIONS });
    }
    const validated = validateSnapshot(snapshotRow.payload);
    if (!validated.ok) throw new SeoError("SNAPSHOT_INVALID", 422, { snapshotStatus: "SNAPSHOT_INVALID", resyncInstructions: RESYNC_INSTRUCTIONS });
    snapshot = validated.snapshot;
    snapshotFreshness = "CURRENT";
    url = website.normalizedUrl;
  }
  const errors = {};
  if (!url || url.length > MAX_URL_LENGTH) errors.url = "A URL of 2048 characters or fewer is required.";
  if (Object.keys(errors).length > 0) throw new SeoError("VALIDATION_FAILED", 400, { errors });
  const sanitizedWebsiteUrl = sanitizeWebsiteUrl(url);
  if (!sanitizedWebsiteUrl) throw new SeoError("VALIDATION_FAILED", 400, { errors: { url: "The URL must be a valid http(s) URL without credentials." } });

  // Tool 08/09 advisory context (websiteId path only): latest summary
  // counts, never merged verdicts.
  let advisoryContext = null;
  if (website) {
    try {
      const [latestSecurity, latestMalware] = await Promise.all([
        prisma.securityDiagnostic.findFirst({ where: { userId, websiteId: website.id }, orderBy: { createdAt: "desc" }, select: { summary: true } }),
        prisma.malwareDiagnostic.findFirst({ where: { userId, websiteId: website.id }, orderBy: { createdAt: "desc" }, select: { summary: true } }),
      ]);
      advisoryContext = {
        securityMatchedAdvisoryCount: latestSecurity?.summary && typeof latestSecurity.summary === "object" ? (latestSecurity.summary.matchedAdvisoryCount ?? null) : null,
        malwareFindingCodes: latestMalware?.summary && typeof latestMalware.summary === "object" ? (latestMalware.summary.findingCodes ?? null) : null,
      };
    } catch { advisoryContext = null; }
  }

  const engine = deps.engine ?? runSeoCheck;
  let result;
  try {
    result = await engine(url, { ...(deps.engineDeps ?? {}), snapshot, advisoryContext });
  } catch {
    // An engine crash must not leak internals; persist a FAILED report
    // with no invented evidence instead.
    result = {
      sanitizedTargetUrl: sanitizedWebsiteUrl,
      requestedTarget: sanitizedWebsiteUrl,
      finalUrl: null,
      executionStatus: "FAILED",
      homepageSummary: { requestedUrl: sanitizedWebsiteUrl, terminalError: "INTERNAL_SCANNER_ERROR" },
      robotsSummary: {},
      sitemapSummary: { status: "MISSING" },
      spamSignals: { keywordCategories: [], externalLinkCount: 0, totalLinkCount: 0, hiddenLinkCount: 0 },
      seoPluginSummary: { status: "NOT_CHECKED", reason: "ENGINE_FAILED", plugins: [] },
      advisoryContext,
      searchConsoleStatus: "NOT_CONFIGURED",
      summary: { findingCodes: ["SEO_CHECK_NOT_RUN"] },
      limitations: ["The check failed before any evidence could be gathered."],
      findings: [{ code: "SEO_CHECK_NOT_RUN", severity: "MEDIUM", title: "SEO check did not run", explanation: "The check could not gather evidence for this target.", evidence: {}, recommendation: "Re-run the check.", confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE", checkId: "engine", evidenceCategory: null, limitations: null }],
    };
  }

  const truncated = result.findings.length > 100;
  const findings = truncated ? result.findings.slice(0, 100) : result.findings;
  const limitations = [...(result.limitations ?? [])];
  if (truncated) limitations.push("The finding list was truncated to 100 entries.");
  if (!website) limitations.push("URL-only run: SEO-plugin evidence was not checked (no connector snapshot); re-run with a registered website for plugin evidence.");

  try {
    const diagnostic = await prisma.$transaction(async (tx) => {
      const created = await tx.seoDiagnostic.create({
        data: {
          userId,
          websiteId: website ? website.id : null,
          sanitizedWebsiteUrl,
          requestedTarget: result.requestedTarget ?? sanitizedWebsiteUrl,
          finalUrl: result.finalUrl ?? null,
          executionStatus: result.executionStatus,
          snapshotSchemaVersion: snapshot ? snapshot.schemaVersion : null,
          snapshotReceivedAt: snapshotRow ? snapshotRow.receivedAt : null,
          snapshotFreshness,
          homepageSummary: result.homepageSummary ?? {},
          robotsSummary: result.robotsSummary ?? {},
          sitemapSummary: result.sitemapSummary ?? {},
          spamSignals: result.spamSignals ?? {},
          seoPluginSummary: result.seoPluginSummary ?? {},
          advisoryContext: result.advisoryContext ?? {},
          searchConsoleStatus: result.searchConsoleStatus ?? "NOT_CONFIGURED",
          summary: result.summary ?? {},
          limitations,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      if (findings.length > 0) {
        await tx.seoDiagnosticFinding.createMany({
          data: findings.map((f) => ({
            diagnosticId: created.id,
            code: f.code,
            severity: f.severity,
            title: f.title,
            explanation: f.explanation,
            evidence: f.evidence ?? {},
            recommendation: f.recommendation,
            confidence: f.confidence,
            evidenceStatus: f.evidenceStatus ?? null,
            limitations: f.limitations ?? null,
            checkId: f.checkId ?? null,
            evidenceCategory: f.evidenceCategory ?? null,
          })),
        });
      }
      return created;
    });
    const rows = await prisma.seoDiagnosticFinding.findMany({ where: { diagnosticId: diagnostic.id }, orderBy: { createdAt: "asc" } });
    return seoSummary(diagnostic, rows.map(publicFinding));
  } catch {
    throw new SeoError("DATABASE_OPERATION_FAILED", 500);
  }
}
