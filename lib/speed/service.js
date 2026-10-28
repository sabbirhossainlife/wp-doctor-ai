// Speed diagnostic service (Milestone 9). Synchronous bounded flow:
//   user URL -> M2 scanner preflight (SSRF-safe, pinned, redirect-validated)
//     -> provider target = final URL with query + fragment stripped
//     -> PageSpeed Insights (lab) + CrUX (field, page then origin fallback)
//     -> deterministic engine -> persisted report + findings.
// Only url + strategy are ever read from client input; client-supplied
// scores, metrics, provider responses, and ownership fields are ignored.
// Keys are server-only env vars, never stored or returned. Google fetches
// the target from ITS OWN infrastructure; local connection pinning governs
// only the preflight, never Google's requests — documented in
// docs/website-speed-analyzer.md. No cross-user cache exists: every report
// is the requesting user's own row.
// Statuses actually produced: COMPLETED | PARTIAL | FAILED | BLOCKED.
// (No QUEUED/RUNNING: there is no async mechanism in this milestone.)
import { prisma } from "../prisma.js";
import { scanUrl, ScannerError, redactUrlForLog } from "../scanner/index.js";
import { fetchPsi, fetchCrux, ProviderError } from "./providers.js";
import { runSpeedRules } from "./engine.js";
import { sharedSpeedLimiter } from "./rate-limit.js";

export const SPEED_STRATEGIES = ["MOBILE", "DESKTOP"];
const MAX_URL_LENGTH = 2048;
const DUPLICATE_WINDOW_MS = 60 * 1000;

export class SpeedError extends Error {
  constructor(code, status, payload = {}) {
    super(code);
    this.name = "SpeedError";
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

function getEnv(env, key) {
  const v = env[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// Strip query + fragment for provider calls AND storage. The query string
// may carry secrets, so it is never sent to Google and never stored; the
// record keeps queryStripped=true so the transformation is visible.
export function providerTargetFromUrl(urlString) {
  const parsed = new URL(urlString);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}

export function requestedTargetFromUrl(urlString) {
  return redactUrlForLog(urlString);
}

function safeHttpSummary(result) {
  return {
    status: result.finalStatus,
    redirectCount: result.redirectCount,
    finalUrl: result.finalUrl,
    elapsedMs: result.durationMs,
    // Total response time (all hops). NEVER labelled TTFB.
    totalResponseMs: result.durationMs,
    chain: (result.chain ?? []).slice(0, 10).map((hop) => ({
      url: hop.url,
      status: hop.status,
    })),
  };
}

export function publicFinding(row) {
  return {
    id: row.id,
    ruleId: row.ruleId,
    category: row.category,
    severity: row.severity,
    source: row.source,
    sourceAuditId: row.sourceAuditId,
    sourceMetric: row.sourceMetric,
    title: row.title,
    description: row.description,
    evidence: row.evidence,
    recommendation: row.recommendation,
    confidence: row.confidence,
    relatedMetric: row.relatedMetric,
  };
}

export function speedSummary(diagnostic, findings = []) {
  return {
    id: diagnostic.id,
    requestedTarget: diagnostic.requestedTarget,
    providerTarget: diagnostic.providerTarget,
    queryStripped: diagnostic.queryStripped,
    strategy: diagnostic.strategy,
    status: diagnostic.status,
    httpSummary: diagnostic.httpSummary,
    lighthouseSummary: diagnostic.lighthouseSummary,
    cruxSummary: diagnostic.cruxSummary,
    providerStatuses: diagnostic.providerStatuses,
    notices: diagnostic.notices,
    createdAt: diagnostic.createdAt ? diagnostic.createdAt.toISOString() : null,
    completedAt: diagnostic.completedAt ? diagnostic.completedAt.toISOString() : null,
    findings,
  };
}

async function defaultPreflight(url) {
  return scanUrl(url);
}

export async function createSpeedDiagnostic(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedSpeedLimiter;
  if (limiter && !limiter.check(userId)) {
    throw new SpeedError("RATE_LIMITED", 429);
  }
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  const strategy = input?.strategy ?? "MOBILE";
  const errors = {};
  if (!url || url.length > MAX_URL_LENGTH) errors.url = "A URL of 2048 characters or fewer is required.";
  if (!SPEED_STRATEGIES.includes(strategy)) errors.strategy = "Strategy must be MOBILE or DESKTOP.";
  if (Object.keys(errors).length > 0) throw new SpeedError("VALIDATION_FAILED", 400, { errors });

  // Duplicate-submit guard: same user, same sanitized target + strategy
  // within 60 s returns the existing report instead of re-running providers.
  const requestedTarget = (() => {
    try { return requestedTargetFromUrl(new URL(url).toString()); } catch { return null; }
  })();
  if (requestedTarget) {
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const recent = await prisma.speedDiagnostic.findFirst({
      where: { userId, requestedTarget, strategy, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      include: { findings: { orderBy: { createdAt: "asc" } } },
    });
    if (recent) {
      return { ...speedSummary(recent, recent.findings.map(publicFinding)), duplicateOfRecent: true };
    }
  }

  const env = deps.env ?? process.env;
  const psiKey = getEnv(env, "GOOGLE_PAGESPEED_API_KEY");
  const cruxKey = getEnv(env, "GOOGLE_CRUX_API_KEY");
  const fetchFn = deps.fetchFn;
  const preflight = deps.preflight ?? defaultPreflight;

  let httpSummary = null;
  let httpErrorCode = null;
  let providerTarget = null;
  try {
    const result = await preflight(url);
    httpSummary = safeHttpSummary(result);
    providerTarget = providerTargetFromUrl(result.finalUrl);
  } catch (err) {
    httpErrorCode = err instanceof ScannerError ? err.code : "INTERNAL_SCANNER_ERROR";
    // Policy rejections are BLOCKED; transport/DNS/timeout failures are FAILED.
    const blocked = ["INVALID_URL", "UNSUPPORTED_SCHEME", "UNSUPPORTED_PORT", "PROHIBITED_DESTINATION"].includes(httpErrorCode);
    const status = blocked ? "BLOCKED" : "FAILED";
    const diagnostic = await prisma.speedDiagnostic.create({
      data: {
        userId,
        requestedTarget: requestedTarget ?? "[invalid-url]",
        providerTarget: null,
        queryStripped: true,
        strategy,
        status,
        httpSummary: { status: null, redirectCount: null, finalUrl: null, elapsedMs: null, totalResponseMs: null, chain: [], errorCode: httpErrorCode },
        lighthouseSummary: null,
        cruxSummary: null,
        providerStatuses: { psi: "NOT_ATTEMPTED", crux: "NOT_ATTEMPTED", httpErrorCode },
        notices: [{ code: status, detail: `The preflight check could not reach this URL (${httpErrorCode}). No provider request was made.` }],
        completedAt: new Date(),
      },
    });
    return speedSummary(diagnostic, []);
  }

  // ---- Providers (one failure never destroys the report) ----
  const providerStatuses = { psi: psiKey ? "PENDING" : "NOT_CONFIGURED", crux: cruxKey ? "PENDING" : "NOT_CONFIGURED" };
  let lighthouseSummary = null;
  if (psiKey) {
    try {
      lighthouseSummary = await fetchPsi({ target: providerTarget, strategy, apiKey: psiKey, fetchFn: fetchFn ?? fetch });
      providerStatuses.psi = "OK";
    } catch (err) {
      providerStatuses.psi = err instanceof ProviderError ? err.code : "FAILED";
    }
  }
  let cruxSummary = null;
  if (cruxKey) {
    const formFactor = strategy === "DESKTOP" ? "DESKTOP" : "PHONE";
    try {
      cruxSummary = await fetchCrux({ target: providerTarget, scope: "page", formFactor, apiKey: cruxKey, fetchFn: fetchFn ?? fetch });
      providerStatuses.crux = "OK";
    } catch (err) {
      if (err instanceof ProviderError && err.code === "NO_FIELD_DATA") {
        // Origin-level fallback, explicitly labelled scope=origin — never
        // presented as page-level data.
        try {
          const origin = new URL(providerTarget).origin;
          cruxSummary = await fetchCrux({ target: origin, scope: "origin", formFactor, apiKey: cruxKey, fetchFn: fetchFn ?? fetch });
          providerStatuses.crux = "OK_ORIGIN_FALLBACK";
        } catch (fallbackErr) {
          providerStatuses.crux = fallbackErr instanceof ProviderError ? fallbackErr.code : "FAILED";
        }
      } else {
        providerStatuses.crux = err instanceof ProviderError ? err.code : "FAILED";
      }
    }
  }

  const { findings, notices } = runSpeedRules({ http: httpSummary, lighthouse: lighthouseSummary, crux: cruxSummary, providerStatuses });
  const allSourcesOk = providerStatuses.psi === "OK" && (providerStatuses.crux === "OK" || providerStatuses.crux === "OK_ORIGIN_FALLBACK");
  const status = allSourcesOk ? "COMPLETED" : "PARTIAL";

  try {
    const diagnostic = await prisma.$transaction(async (tx) => {
      const created = await tx.speedDiagnostic.create({
        data: {
          userId,
          requestedTarget: requestedTarget ?? providerTarget,
          providerTarget,
          queryStripped: true,
          strategy,
          status,
          httpSummary,
          lighthouseSummary,
          cruxSummary,
          providerStatuses,
          notices,
          completedAt: new Date(),
        },
      });
      if (findings.length > 0) {
        await tx.speedDiagnosticFinding.createMany({
          data: findings.map((f) => ({
            diagnosticId: created.id,
            ruleId: f.ruleId,
            category: f.category,
            severity: f.severity,
            source: f.source,
            sourceAuditId: f.sourceAuditId ?? null,
            sourceMetric: f.sourceMetric ?? null,
            title: f.title,
            description: f.description,
            evidence: f.evidence ?? {},
            recommendation: f.recommendation,
            confidence: f.confidence,
            relatedMetric: f.relatedMetric ?? null,
          })),
        });
      }
      return created;
    });
    const rows = await prisma.speedDiagnosticFinding.findMany({
      where: { diagnosticId: diagnostic.id },
      orderBy: { createdAt: "asc" },
    });
    return speedSummary(diagnostic, rows.map(publicFinding));
  } catch {
    throw new SpeedError("DATABASE_OPERATION_FAILED", 500);
  }
}
