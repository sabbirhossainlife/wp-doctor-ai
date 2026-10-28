// Tool 08 service (Milestone 12). Synchronous bounded flow:
// session user -> owned Website record + latest snapshot + 24 h freshness
// gate -> provider advisory matching (WPVulnerability, keyless, fixed host)
// -> passive HTTP observations (M2 pinned components) -> deterministic
// rules -> persisted report. ONLY websiteId is read from client input;
// client-supplied URL, inventory, versions, findings, severities,
// vulnerability status, and provider data are ignored or rejected.
// There is NO URL-only full vulnerability scan: a full scan requires a
// registered, owned website with a fresh snapshot. This flow contains NO
// login, brute-force, form-submit, upload, exploit-payload, activation,
// deactivation, update, delete, or mutation path at all — by construction
// there is no such function to call. Never stored: response bodies,
// secrets, credentials, config files, user lists, orders, customers, or
// any client-supplied data.
import { prisma } from "../prisma.js";
import { runSecurityRules } from "./rules.js";
import { runPassiveHttpChecks } from "./http.js";
import {
  providerConfig, isSupportedProviderName, queryWpvulnerability,
  matchAdvisories, PROVIDER_ID, ProviderError,
} from "./provider.js";
import { securitySnapshotFreshness, RESYNC_INSTRUCTIONS } from "./freshness.js";
import { sharedSecurityLimiter } from "./rate-limit.js";

export class SecurityError extends Error {
  constructor(code, status, payload = {}) {
    super(code);
    this.name = "SecurityError";
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
    limitations: row.limitations,
    advisory: (row.advisoryId || row.cveId || row.sourceUrl || row.fixedVersion)
      ? { advisoryId: row.advisoryId ?? null, cveId: row.cveId ?? null, sourceUrl: row.sourceUrl ?? null, fixedVersion: row.fixedVersion ?? null, retrievedAt: row.retrievedAt ? row.retrievedAt.toISOString() : null }
      : null,
  };
}

export function securitySummary(diagnostic, findings = [], aiAnalysis = null) {
  return {
    id: diagnostic.id,
    websiteId: diagnostic.websiteId ?? null,
    sanitizedWebsiteUrl: diagnostic.sanitizedWebsiteUrl,
    executionStatus: diagnostic.executionStatus,
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    snapshotReceivedAt: diagnostic.snapshotReceivedAt ? diagnostic.snapshotReceivedAt.toISOString() : null,
    snapshotFreshness: diagnostic.snapshotFreshness,
    componentInventorySummary: diagnostic.componentInventorySummary,
    advisoryMatchSummary: diagnostic.advisoryMatchSummary,
    providerStatuses: diagnostic.providerStatuses,
    httpObservations: diagnostic.httpObservations,
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

export async function listSecurityDiagnostics(userId, { page = 1, pageSize = 20 } = {}) {
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.securityDiagnostic.count({ where: { userId } }),
    prisma.securityDiagnostic.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip, take,
      include: { findings: { orderBy: { createdAt: "asc" } } },
    }),
  ]);
  return { diagnostics: rows.map((d) => securitySummary(d, d.findings.map(publicFinding))), total, page, pageSize: take };
}

export async function getSecurityDiagnostic(userId, id) {
  return prisma.securityDiagnostic.findFirst({
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

function boundedString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function snapshotComponents(payload) {
  const components = [];
  components.push({
    productType: "core", slug: null, name: "WordPress core",
    version: boundedString(payload.wordpressVersion, 50) ?? null,
    active: true, updateAvailable: null, newVersion: null,
  });
  const plugins = Array.isArray(payload.plugins) ? payload.plugins : [];
  for (const p of plugins) {
    components.push({
      productType: "plugin",
      slug: typeof p.slug === "string" ? p.slug.slice(0, 100) : null,
      name: boundedString(p.name, 200) ?? "Unknown plugin",
      version: boundedString(p.version, 50) ?? null,
      active: p.active === true, networkActive: p.networkActive === true, muPlugin: p.muPlugin === true,
      updateAvailable: p.updateAvailable === true ? true : false,
      newVersion: boundedString(p.newVersion, 50) ?? null,
    });
  }
  const theme = payload.theme && typeof payload.theme === "object" ? payload.theme : null;
  components.push({
    productType: "theme", slug: null,
    name: theme?.name ? String(theme.name).slice(0, 200) : "Active theme",
    version: theme?.version ? String(theme.version).slice(0, 50) : null,
    active: true, updateAvailable: null, newVersion: null,
  });
  return components;
}

function sanitizeHomepageObservation(homepage) {
  if (!homepage || typeof homepage !== "object") return null;
  const wanted = ["strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"];
  const headers = {};
  for (const name of wanted) {
    const value = homepage.headers?.[name];
    if (typeof value === "string") headers[name] = value.slice(0, 500);
  }
  let finalUrl = null;
  try {
    if (typeof homepage.finalUrl === "string") {
      const u = new URL(homepage.finalUrl);
      finalUrl = `${u.protocol}//${u.host}${u.pathname}`;
    }
  } catch { finalUrl = null; }
  return {
    finalUrl, status: homepage.status ?? null, headers,
    redirectCount: homepage.redirectCount ?? 0,
    crossHostRedirect: homepage.crossHostRedirect === true,
    error: homepage.error ?? null,
  };
}

// Query the provider for every matchable component with a concurrency cap.
// Returns { providerStatuses, components } where each component gains
// status/matchedAdvisories/insufficientAdvisories/retrievedAt.
async function runProviderChecks(components, { config, fetchFn }) {
  if (config.name === "none") {
    return {
      providerStatuses: [{ providerId: PROVIDER_ID, status: "PROVIDER_UNAVAILABLE", reason: "VULNERABILITY_PROVIDER is set to none: vulnerability intelligence is explicitly disabled.", retrievedAt: null }],
      components: components.map((c) => ({ ...c, status: c.productType === "theme" ? "COMPONENT_IDENTITY_UNCERTAIN" : "PROVIDER_UNAVAILABLE", matchedAdvisories: [], insufficientAdvisories: [], retrievedAt: null })),
    };
  }
  if (!isSupportedProviderName(config.name)) {
    return {
      providerStatuses: [{ providerId: config.name, status: "PROVIDER_UNAVAILABLE", reason: `Provider "${config.name}" is not supported. WPScan requires a commercial licence and API token, which are not configured; only WPVulnerability is supported. No advisory matching ran.`, retrievedAt: null }],
      components: components.map((c) => ({ ...c, status: c.productType === "theme" ? "COMPONENT_IDENTITY_UNCERTAIN" : "PROVIDER_UNAVAILABLE", matchedAdvisories: [], insufficientAdvisories: [], retrievedAt: null })),
    };
  }
  const matchable = components.filter((c) => c.productType === "core" || (c.productType === "plugin" && typeof c.slug === "string" && c.slug !== ""));
  const limited = matchable.slice(0, config.maxComponents);
  const results = new Map();
  let providerStatus = { providerId: PROVIDER_ID, status: "OK", reason: null, retrievedAt: null };
  let next = 0;
  const workers = Array.from({ length: Math.min(config.concurrency, Math.max(limited.length, 1)) }, async () => {
    while (next < limited.length) {
      const comp = limited[next++];
      try {
        const key = comp.productType === "core" ? comp.version : comp.slug;
        if (!key) {
          results.set(comp, { status: "COMPONENT_VERSION_UNKNOWN", matched: [], insufficient: [], retrievedAt: null });
          continue;
        }
        const { advisories, retrievedAt } = await queryWpvulnerability(comp.productType, key, { fetchFn, config });
        const matched = matchAdvisories(comp, advisories.map((a) => ({ ...a, retrievedAt })));
        results.set(comp, { status: matched.status, matched: matched.matched, insufficient: matched.insufficient, retrievedAt });
        if (!providerStatus.retrievedAt) providerStatus.retrievedAt = retrievedAt;
      } catch (err) {
        const status = err instanceof ProviderError ? err.status : "PROVIDER_ERROR";
        if (providerStatus.status === "OK") providerStatus = { providerId: PROVIDER_ID, status, reason: err?.reason ?? "PROVIDER_ERROR", retrievedAt: null };
        results.set(comp, { status, matched: [], insufficient: [{ advisoryId: null, reason: err?.reason ?? "PROVIDER_ERROR" }], retrievedAt: null });
      }
    }
  });
  await Promise.all(workers);
  const out = components.map((c) => {
    if (c.productType === "theme") return { ...c, status: "COMPONENT_IDENTITY_UNCERTAIN", matchedAdvisories: [], insufficientAdvisories: [], retrievedAt: null };
    if (c.productType === "plugin" && (!c.slug || c.slug === "")) return { ...c, status: "COMPONENT_IDENTITY_UNCERTAIN", matchedAdvisories: [], insufficientAdvisories: [], retrievedAt: null };
    if (!results.has(c)) return { ...c, status: "INSUFFICIENT_EVIDENCE", matchedAdvisories: [], insufficientAdvisories: [{ advisoryId: null, reason: "COMPONENT_LIMIT_EXCEEDED" }], retrievedAt: null };
    const r = results.get(c);
    return { ...c, status: r.status, matchedAdvisories: r.matched, insufficientAdvisories: r.insufficient, retrievedAt: r.retrievedAt };
  });
  return { providerStatuses: [providerStatus], components: out };
}

export async function createSecurityDiagnostic(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedSecurityLimiter;
  if (limiter && !limiter.check(userId)) {
    throw new SecurityError("RATE_LIMITED", 429);
  }
  const websiteId = typeof input?.websiteId === "string" && input.websiteId.trim() !== "" ? input.websiteId.trim() : null;
  if (!websiteId) throw new SecurityError("VALIDATION_FAILED", 400, { errors: { websiteId: "A registered website is required for a full security scan." } });

  const website = await prisma.website.findFirst({ where: { id: websiteId, userId }, include: { connection: true } });
  if (!website) throw new SecurityError("WEBSITE_NOT_FOUND", 404);
  const connection = website.connection;
  if (!connection || connection.status !== "ACTIVE" || website.connectionStatus !== "CONNECTED") {
    throw new SecurityError("SNAPSHOT_MISSING", 422, { snapshotStatus: "SNAPSHOT_MISSING", resyncInstructions: RESYNC_INSTRUCTIONS });
  }
  const snapshotRow = await prisma.connectorDiagnosticSnapshot.findFirst({
    where: { connectionId: connection.id },
    orderBy: { receivedAt: "desc" },
  });
  const freshness = securitySnapshotFreshness(snapshotRow, { nowMs: deps.nowMs ?? Date.now() });
  if (freshness.status !== "CURRENT") {
    throw new SecurityError(freshness.status, 422, { snapshotStatus: freshness.status, resyncInstructions: RESYNC_INSTRUCTIONS });
  }
  const snapshotPayload = snapshotRow.payload;
  const sanitizedWebsiteUrl = sanitizeWebsiteUrl(website.normalizedUrl);
  if (!sanitizedWebsiteUrl) throw new SecurityError("VALIDATION_FAILED", 400, { errors: { websiteId: "The registered website URL is not a valid http(s) URL." } });

  const rawComponents = snapshotComponents(snapshotPayload);
  const indicators = snapshotPayload.schemaVersion >= 6 && snapshotPayload.securityIndicators && typeof snapshotPayload.securityIndicators === "object"
    ? {
        wpDebug: snapshotPayload.securityIndicators.wpDebug ?? "unknown",
        wpDebugDisplay: snapshotPayload.securityIndicators.wpDebugDisplay ?? "unknown",
        wpDebugLog: snapshotPayload.securityIndicators.wpDebugLog ?? "unknown",
        disallowFileEdit: snapshotPayload.securityIndicators.disallowFileEdit ?? "unknown",
      }
    : null;

  const config = deps.providerConfig ?? providerConfig();
  const { providerStatuses, components } = await runProviderChecks(rawComponents, { config, fetchFn: deps.providerFetch });

  let http;
  try {
    http = await runPassiveHttpChecks(sanitizedWebsiteUrl, deps.httpProbe ? { probe: deps.httpProbe } : {});
  } catch {
    http = {
      homepage: { finalUrl: sanitizedWebsiteUrl, status: null, headers: {}, redirectCount: 0, crossHostRedirect: false, error: "PROBE_FAILED" },
      xmlrpc: { status: null, responds: false, error: "PROBE_FAILED" },
      sensitivePaths: [],
    };
  }
  // Sanitize HTTP observations for storage: homepage headers filtered to
  // the six security headers, sensitive paths as classifications only.
  // No response body, secret, or full header set is ever persisted.
  const httpObservations = {
    homepage: sanitizeHomepageObservation(http.homepage),
    xmlrpc: { status: http.xmlrpc?.status ?? null, responds: http.xmlrpc?.responds === true, error: http.xmlrpc?.error ?? null },
    sensitivePaths: Array.isArray(http.sensitivePaths) ? http.sensitivePaths.map((p) => ({
      path: typeof p.path === "string" ? p.path.slice(0, 100) : null,
      status: p.status ?? null,
      contentTypeCategory: p.contentTypeCategory ?? null,
      result: p.result ?? null,
      reason: typeof p.reason === "string" ? p.reason.slice(0, 100) : null,
    })) : [],
  };

  let findings = runSecurityRules({
    components, securityIndicators: indicators, snapshotSchemaVersion: snapshotPayload.schemaVersion,
    providerStatuses, http: { homepage: http.homepage, xmlrpc: http.xmlrpc, sensitivePaths: http.sensitivePaths },
  });
  const truncated = findings.length > 200;
  if (truncated) findings = findings.slice(0, 200);

  const providerOk = providerStatuses.every((p) => p.status === "OK");
  const httpOk = !http.homepage?.error && http.homepage?.status !== null && !(http.sensitivePaths ?? []).some((p) => p.result === "NOT_RUN") && !http.xmlrpc?.error;
  const executionStatus = providerOk && httpOk ? "COMPLETED" : "PARTIAL";

  const matchedCount = components.reduce((n, c) => n + (c.matchedAdvisories?.length ?? 0), 0);
  const componentStatuses = {};
  for (const c of components) componentStatuses[c.status] = (componentStatuses[c.status] ?? 0) + 1;
  const limitations = [
    "A report with no matching advisory in the checked source does NOT mean the site is secure: it only means the queried source returned no match for the checked components.",
    "A version-matched advisory is a potential vulnerability, not proof of exploitation; exploitability was not tested.",
    "Theme advisories are not matched by slug because the snapshot theme object carries no canonical slug; theme identity is reported as uncertain.",
    "A 403/404 on a sensitive path does not prove the file is absent; a 200 without a matching signature does not confirm exposure.",
    "Missing or weak security headers are hardening gaps, not confirmed vulnerabilities.",
    "Only WPVulnerability was queried for advisories; other sources may list additional advisories.",
  ];
  if (truncated) limitations.push("The finding list was truncated to 200 entries; the most severe advisory and exposure findings are listed first by construction of the rules order.");
  if (components.length > config.maxComponents) limitations.push(`Provider queries were capped at ${config.maxComponents} components; some installed plugins were not queried.`);

  const summary = {
    snapshotStatus: "CURRENT",
    providerStatuses: providerStatuses.map((p) => ({ providerId: p.providerId, status: p.status })),
    componentCount: components.length,
    componentStatuses,
    matchedAdvisoryCount: matchedCount,
    findingCodes: findings.map((f) => f.code),
    executionStatus,
    httpOk,
  };
  const componentInventorySummary = {
    core: { version: components.find((c) => c.productType === "core")?.version ?? null },
    plugins: components.filter((c) => c.productType === "plugin").slice(0, 100).map((c) => ({
      slug: c.slug, name: c.name, version: c.version, active: c.active,
      updateAvailable: c.updateAvailable, newVersion: c.newVersion, providerStatus: c.status,
    })),
    theme: { name: components.find((c) => c.productType === "theme")?.name ?? null, version: components.find((c) => c.productType === "theme")?.version ?? null, providerStatus: "COMPONENT_IDENTITY_UNCERTAIN" },
    securityIndicators: indicators,
    snapshotSchemaVersion: snapshotPayload.schemaVersion,
  };
  const advisoryMatchSummary = {
    providerId: PROVIDER_ID,
    matchedAdvisoryCount: matchedCount,
    components: components.map((c) => ({
      productType: c.productType, slug: c.slug, version: c.version, status: c.status,
      matchedAdvisoryIds: (c.matchedAdvisories ?? []).map((a) => a.advisoryId),
      retrievedAt: c.retrievedAt ?? null,
    })),
  };

  try {
    const diagnostic = await prisma.$transaction(async (tx) => {
      const created = await tx.securityDiagnostic.create({
        data: {
          userId, websiteId: website.id,
          sanitizedWebsiteUrl,
          executionStatus,
          snapshotSchemaVersion: snapshotPayload.schemaVersion,
          snapshotReceivedAt: snapshotRow.receivedAt,
          snapshotFreshness: "CURRENT",
          componentInventorySummary,
          advisoryMatchSummary,
          providerStatuses: providerStatuses.map((p) => ({ providerId: p.providerId, status: p.status, reason: p.reason ?? null, retrievedAt: p.retrievedAt ?? null })),
          httpObservations,
          summary,
          limitations,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      if (findings.length > 0) {
        await tx.securityDiagnosticFinding.createMany({
          data: findings.map((f) => ({
            diagnosticId: created.id,
            code: f.code, severity: f.severity, title: f.title,
            explanation: f.explanation, evidence: f.evidence ?? {},
            recommendation: f.recommendation, confidence: f.confidence,
            evidenceStatus: f.evidenceStatus ?? null, limitations: f.limitations ?? null,
            advisoryId: f.advisory?.advisoryId ?? null,
            cveId: f.advisory?.cveId ?? null,
            sourceUrl: f.advisory?.sourceUrl ?? null,
            fixedVersion: f.advisory?.fixedVersion ?? null,
            retrievedAt: f.advisory?.retrievedAt ? new Date(f.advisory.retrievedAt) : null,
          })),
        });
      }
      return created;
    });
    const rows = await prisma.securityDiagnosticFinding.findMany({ where: { diagnosticId: diagnostic.id }, orderBy: { createdAt: "asc" } });
    return securitySummary(diagnostic, rows.map(publicFinding));
  } catch {
    throw new SecurityError("DATABASE_OPERATION_FAILED", 500);
  }
}
