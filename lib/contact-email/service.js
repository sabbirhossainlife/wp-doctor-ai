// Tool 07 service (Milestone 11). Synchronous bounded flow:
// session user -> (owned Website record + latest snapshot + 24 h freshness
// gate) OR (URL-only, no snapshot) -> deterministic rules + bounded public
// DNS checks -> persisted report. Only websiteId, url, emailDomain and
// dkimSelector are ever read from client input; client-supplied findings,
// snapshots, observations, and ownership fields are ignored. This flow
// contains NO email-send, form-submit, SMTP-connection, or config-mutation
// path at all: there is no send/submit function to call, by construction.
// Never stored: secrets, credentials, full email addresses, recipients,
// form submissions, message bodies, full page content, raw config, or
// arbitrary option contents. Stored DNS data is public TXT excerpts only.
import { prisma } from "../prisma.js";
import { runEmailDnsChecks } from "./dns.js";
import { runContactEmailRules, deliveryNotVerifiedFinding } from "./rules.js";
import { contactEmailSnapshotFreshness, RESYNC_INSTRUCTIONS } from "./freshness.js";
import { isPublicDomain, isValidDkimSelector, defaultEmailDomainFromUrl } from "./domain.js";
import { sharedContactEmailLimiter } from "./rate-limit.js";

const MAX_URL_LENGTH = 2048;

export class ContactEmailError extends Error {
  constructor(code, status, payload = {}) {
    super(code);
    this.name = "ContactEmailError";
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
  };
}

export function contactEmailSummary(diagnostic, findings = []) {
  return {
    id: diagnostic.id,
    websiteId: diagnostic.websiteId ?? null,
    sanitizedTargetUrl: diagnostic.sanitizedTargetUrl,
    sanitizedEmailDomain: diagnostic.sanitizedEmailDomain,
    dkimSelector: diagnostic.dkimSelector,
    executionStatus: diagnostic.executionStatus,
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    snapshotReceivedAt: diagnostic.snapshotReceivedAt ? diagnostic.snapshotReceivedAt.toISOString() : null,
    snapshotFreshness: diagnostic.snapshotFreshness,
    snapshotCopy: diagnostic.snapshotCopy,
    spfObservation: diagnostic.spfObservation,
    dmarcObservation: diagnostic.dmarcObservation,
    dkimObservation: diagnostic.dkimObservation,
    summary: diagnostic.summary,
    startedAt: diagnostic.startedAt ? diagnostic.startedAt.toISOString() : null,
    completedAt: diagnostic.completedAt ? diagnostic.completedAt.toISOString() : null,
    createdAt: diagnostic.createdAt ? diagnostic.createdAt.toISOString() : null,
    findings,
  };
}

export async function listContactEmailDiagnostics(userId, { page = 1, pageSize = 20 } = {}) {
  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.contactEmailDiagnostic.count({ where: { userId } }),
    prisma.contactEmailDiagnostic.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { findings: { orderBy: { createdAt: "asc" } } },
    }),
  ]);
  return { diagnostics: rows.map((d) => contactEmailSummary(d, d.findings.map(publicFinding))), total, page, pageSize: take };
}

export async function getContactEmailDiagnostic(userId, id) {
  return prisma.contactEmailDiagnostic.findFirst({
    where: { id, userId },
    include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
  });
}

function sanitizeTargetUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function boundedFormEntry(f) {
  if (!f || typeof f !== "object") return null;
  return {
    pluginId: typeof f.pluginId === "string" ? f.pluginId.slice(0, 100) : null,
    name: typeof f.name === "string" ? f.name.slice(0, 200) : null,
    installed: f.installed === true,
    active: f.active === true,
    version: typeof f.version === "string" ? f.version.slice(0, 50) : null,
    adapterName: typeof f.adapterName === "string" ? f.adapterName.slice(0, 100) : null,
    adapterVersion: typeof f.adapterVersion === "string" ? f.adapterVersion.slice(0, 50) : null,
    coverage: ["COMPLETE", "PARTIAL", "UNSUPPORTED"].includes(f.coverage) ? f.coverage : "UNSUPPORTED",
    formsCount: Number.isInteger(f.formsCount) ? f.formsCount : null,
    notificationConfigured: ["yes", "no", "unknown"].includes(f.notificationConfigured) ? f.notificationConfigured : null,
    mailConfigStatus: ["CONFIGURED", "PARTIAL", "INCOMPLETE", "UNKNOWN", "NO_FORMS"].includes(f.mailConfigStatus) ? f.mailConfigStatus : null,
  };
}

function boundedMailEntry(m) {
  if (!m || typeof m !== "object") return null;
  const domain = typeof m.senderDomain === "string" && !m.senderDomain.includes("@") ? m.senderDomain.slice(0, 253) : null;
  return {
    pluginId: typeof m.pluginId === "string" ? m.pluginId.slice(0, 100) : null,
    name: typeof m.name === "string" ? m.name.slice(0, 200) : null,
    installed: m.installed === true,
    active: m.active === true,
    version: typeof m.version === "string" ? m.version.slice(0, 50) : null,
    configPresent: ["yes", "no", "unknown"].includes(m.configPresent) ? m.configPresent : null,
    requiredFieldsComplete: ["yes", "no", "unknown"].includes(m.requiredFieldsComplete) ? m.requiredFieldsComplete : null,
    mailer: typeof m.mailer === "string" ? m.mailer.slice(0, 50) : null,
    senderConfigured: ["yes", "no", "unknown"].includes(m.senderConfigured) ? m.senderConfigured : null,
    senderDomain: domain,
    coverage: ["COMPLETE", "PARTIAL", "UNSUPPORTED"].includes(m.coverage) ? m.coverage : "UNSUPPORTED",
  };
}

export async function createContactEmailDiagnostic(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedContactEmailLimiter;
  if (limiter && !limiter.check(userId)) {
    throw new ContactEmailError("RATE_LIMITED", 429);
  }
  const websiteId = typeof input?.websiteId === "string" && input.websiteId.trim() !== "" ? input.websiteId.trim() : null;
  let rawUrl = typeof input?.url === "string" ? input.url.trim() : "";
  const suppliedDomain = typeof input?.emailDomain === "string" ? input.emailDomain.trim().toLowerCase() : "";
  const dkimSelector = typeof input?.dkimSelector === "string" ? input.dkimSelector.trim() : "";
  const errors = {};
  if (suppliedDomain !== "" && !isPublicDomain(suppliedDomain)) {
    errors.emailDomain = "Enter a valid public email domain (for example example.com). IP addresses, localhost, and single-label names are not accepted.";
  }
  if (dkimSelector !== "" && !isValidDkimSelector(dkimSelector)) {
    errors.dkimSelector = "A DKIM selector may contain only letters, numbers, hyphens, and underscores, up to 63 characters.";
  }
  if (Object.keys(errors).length > 0) throw new ContactEmailError("VALIDATION_FAILED", 400, { errors });

  let website = null;
  let snapshotRow = null;
  let snapshotStatus = "NOT_PROVIDED";
  let snapshotPayload = null;
  let snapshotFreshness = "NOT_PROVIDED";
  if (websiteId) {
    website = await prisma.website.findFirst({ where: { id: websiteId, userId }, include: { connection: true } });
    if (!website) throw new ContactEmailError("WEBSITE_NOT_FOUND", 404);
    const connection = website.connection;
    if (!connection || connection.status !== "ACTIVE" || website.connectionStatus !== "CONNECTED") {
      throw new ContactEmailError("SNAPSHOT_MISSING", 422, { snapshotStatus: "SNAPSHOT_MISSING", resyncInstructions: RESYNC_INSTRUCTIONS });
    }
    snapshotRow = await prisma.connectorDiagnosticSnapshot.findFirst({
      where: { connectionId: connection.id },
      orderBy: { receivedAt: "desc" },
    });
    const freshness = contactEmailSnapshotFreshness(snapshotRow, { nowMs: deps.nowMs ?? Date.now() });
    snapshotFreshness = freshness.status;
    if (freshness.status !== "CURRENT") {
      // Blocked: no diagnostic row is persisted for this run.
      throw new ContactEmailError(freshness.status, 422, { snapshotStatus: freshness.status, resyncInstructions: RESYNC_INSTRUCTIONS });
    }
    snapshotPayload = snapshotRow.payload;
    snapshotStatus = snapshotPayload.schemaVersion >= 5 ? "CURRENT" : "OLD_SCHEMA";
    rawUrl = website.normalizedUrl;
  }
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
    throw new ContactEmailError("VALIDATION_FAILED", 400, { errors: { url: "A URL of 2048 characters or fewer is required." } });
  }
  const sanitizedTargetUrl = sanitizeTargetUrl(rawUrl);
  if (!sanitizedTargetUrl) {
    throw new ContactEmailError("VALIDATION_FAILED", 400, { errors: { url: "Enter a valid http(s) URL without credentials." } });
  }

  // Email domain: supplied wins; otherwise the documented default rule
  // (snapshot homeUrl host, else target host, minus one leading www.,
  // only if it yields a valid multi-label public domain).
  let emailDomain = null;
  let emailDomainSource = "unknown";
  if (suppliedDomain !== "") {
    emailDomain = suppliedDomain;
    emailDomainSource = "supplied";
  } else {
    const homeHost = snapshotPayload && typeof snapshotPayload.homeUrl === "string" ? snapshotPayload.homeUrl : sanitizedTargetUrl;
    emailDomain = defaultEmailDomainFromUrl(homeHost);
    emailDomainSource = emailDomain ? "default" : "unknown";
  }

  // Bounded snapshot copy (allowlisted fields only) + sender comparison.
  let contactForms = null;
  let mailTransport = null;
  let senderComparison = null;
  if (snapshotPayload && snapshotStatus === "CURRENT") {
    contactForms = Array.isArray(snapshotPayload.contactForms) ? snapshotPayload.contactForms.map(boundedFormEntry).filter(Boolean) : [];
    mailTransport = Array.isArray(snapshotPayload.mailTransport) ? snapshotPayload.mailTransport.map(boundedMailEntry).filter(Boolean) : [];
    const activeSender = mailTransport.filter((m) => m.active && m.senderDomain);
    const snapshotSender = snapshotPayload.senderDomain && typeof snapshotPayload.senderDomain === "object" ? snapshotPayload.senderDomain : null;
    const senderDomain = activeSender.length > 0 ? activeSender[0].senderDomain : (snapshotSender && typeof snapshotSender.senderDomain === "string" ? snapshotSender.senderDomain : null);
    const senderConfigured = senderDomain ? "yes" : "unknown";
    senderComparison = {
      senderConfigured,
      senderDomain: senderDomain ?? null,
      domainMatches: emailDomain && senderDomain ? senderDomain.toLowerCase() === emailDomain : null,
      comparisonEstablished: Boolean(emailDomain && senderDomain),
    };
  }
  const snapshotCopy = snapshotPayload && snapshotStatus === "CURRENT"
    ? { contactForms, mailTransport, senderComparison }
    : null;

  let dnsResult;
  try {
    dnsResult = await runEmailDnsChecks(emailDomain, dkimSelector === "" ? null : dkimSelector, {
      resolver: deps.dnsResolver,
    });
  } catch {
    dnsResult = {
      spf: { status: "LOOKUP_FAILED" },
      dmarc: { status: "LOOKUP_FAILED" },
      dkim: dkimSelector ? { status: "LOOKUP_FAILED", selector: dkimSelector } : { status: "NOT_CHECKED", reason: "SELECTOR_UNKNOWN", selector: null },
      dnsFailed: true,
    };
  }
  const executionStatus = dnsResult.dnsFailed ? "PARTIAL" : "COMPLETED";
  const findings = runContactEmailRules({
    snapshotStatus,
    contactForms,
    mailTransport,
    senderComparison,
    emailDomain,
    spf: dnsResult.spf,
    dmarc: dnsResult.dmarc,
    dkim: dnsResult.dkim,
    dnsFailed: dnsResult.dnsFailed,
  });
  if (executionStatus === "COMPLETED") findings.push(deliveryNotVerifiedFinding());

  const summary = {
    emailDomain,
    emailDomainSource,
    snapshotStatus,
    spfStatus: dnsResult.spf?.status ?? null,
    dmarcStatus: dnsResult.dmarc?.status ?? null,
    dmarcPolicy: dnsResult.dmarc?.policy ?? null,
    dkimStatus: dnsResult.dkim?.status ?? null,
    dnsFailed: dnsResult.dnsFailed,
    senderComparison,
    findingCodes: findings.map((f) => f.code),
  };

  try {
    const diagnostic = await prisma.$transaction(async (tx) => {
      const created = await tx.contactEmailDiagnostic.create({
        data: {
          userId,
          websiteId: website ? website.id : null,
          sanitizedTargetUrl,
          sanitizedEmailDomain: emailDomain,
          dkimSelector: dkimSelector === "" ? null : dkimSelector,
          executionStatus,
          snapshotSchemaVersion: snapshotPayload ? snapshotPayload.schemaVersion : null,
          snapshotReceivedAt: snapshotRow ? snapshotRow.receivedAt : null,
          snapshotFreshness,
          snapshotCopy: snapshotCopy ?? {},
          spfObservation: dnsResult.spf ?? {},
          dmarcObservation: dnsResult.dmarc ?? {},
          dkimObservation: dnsResult.dkim ?? {},
          summary,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      if (findings.length > 0) {
        await tx.contactEmailFinding.createMany({
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
          })),
        });
      }
      return created;
    });
    const rows = await prisma.contactEmailFinding.findMany({
      where: { diagnosticId: diagnostic.id },
      orderBy: { createdAt: "asc" },
    });
    return contactEmailSummary(diagnostic, rows.map(publicFinding));
  } catch {
    throw new ContactEmailError("DATABASE_OPERATION_FAILED", 500);
  }
}
