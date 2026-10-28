// Elementor diagnostic service (Milestone 8). Mirrors Tool 03's service:
// session user -> ownership in WHERE -> CONNECTED + ACTIVE connection ->
// latest snapshot -> freshness/schema gates -> deterministic engine ->
// persist diagnostic + findings. Blocked runs persist NOTHING and return
// a 422 payload with re-sync instructions. Only websiteId, symptomCategory,
// symptomDescription, affectedScope, affectedPages, deviceScope,
// updatePreceded, startedAt, errorExcerpt are ever read from client input;
// any client snapshot/inventory/connectorId/ownerId is ignored by the route
// before it reaches this service.
import { prisma } from "../prisma.js";
import { runElementorRules } from "./engine.js";
import { elementorSnapshotFreshness, RESYNC_INSTRUCTIONS } from "./freshness.js";
import { redactSecrets } from "../conflict/redact.js";
import { sharedElementorLimiter } from "./rate-limit.js";

export const SYMPTOM_CATEGORIES = [
  "ELEMENTOR_EDITOR_NOT_LOADING",
  "ELEMENTOR_EDITOR_WHITE_SCREEN",
  "ELEMENTOR_EDITOR_GRAY_SCREEN",
  "ELEMENTOR_EDITOR_STUCK_LOADING",
  "ELEMENTOR_PREVIEW_NOT_LOADING",
  "ELEMENTOR_WIDGET_PANEL_NOT_LOADING",
  "ELEMENTOR_JAVASCRIPT_ERROR",
  "ELEMENTOR_CSS_OR_ASSET_ISSUE",
  "FRONTEND_LAYOUT_BROKEN",
  "MOBILE_LAYOUT_ISSUE",
  "ELEMENTOR_FREE_PRO_COMPATIBILITY",
  "PHP_OR_ENVIRONMENT_REQUIREMENT",
  "WORDPRESS_URL_CONFIGURATION",
  "ISSUE_AFTER_UPDATE",
  "OTHER_OR_UNKNOWN",
];

export const AFFECTED_SCOPES = ["editor", "frontend", "both", "unknown"];
export const AFFECTED_PAGES = ["one", "many", "unknown"];
export const DEVICE_SCOPES = ["mobile", "desktop", "both", "unknown"];
export const RESYNC_MESSAGE = RESYNC_INSTRUCTIONS;

export class ElementorError extends Error {
  constructor(code, status, payload = {}) {
    super(code);
    this.name = "ElementorError";
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

function validateSymptom({ symptomCategory, symptomDescription, affectedScope, affectedPages, deviceScope, updatePreceded, startedAt, errorExcerpt }) {
  const errors = {};
  if (!SYMPTOM_CATEGORIES.includes(symptomCategory)) errors.symptomCategory = "Choose a symptom category.";
  if (typeof symptomDescription !== "string" || symptomDescription.trim().length === 0) {
    errors.symptomDescription = "Describe the symptom.";
  } else if (symptomDescription.length > 2000) {
    errors.symptomDescription = "Description must be 2000 characters or fewer.";
  }
  if (affectedScope !== undefined && affectedScope !== null && !AFFECTED_SCOPES.includes(affectedScope)) {
    errors.affectedScope = "Affected scope must be editor, frontend, both, or unknown.";
  }
  if (affectedPages !== undefined && affectedPages !== null && !AFFECTED_PAGES.includes(affectedPages)) {
    errors.affectedPages = "Affected pages must be one, many, or unknown.";
  }
  if (deviceScope !== undefined && deviceScope !== null && !DEVICE_SCOPES.includes(deviceScope)) {
    errors.deviceScope = "Device scope must be mobile, desktop, both, or unknown.";
  }
  if (updatePreceded !== undefined && updatePreceded !== null && typeof updatePreceded !== "boolean") {
    errors.updatePreceded = "Update preceded must be true, false, or omitted (unknown).";
  }
  if (startedAt !== undefined && startedAt !== null && startedAt !== "") {
    if (typeof startedAt !== "string") errors.startedAt = "When it started must be text.";
    else if (startedAt.length > 200) errors.startedAt = "When it started must be 200 characters or fewer.";
  }
  if (errorExcerpt !== undefined && errorExcerpt !== null && errorExcerpt !== "") {
    if (typeof errorExcerpt !== "string") errors.errorExcerpt = "Error excerpt must be text.";
    else if (errorExcerpt.length > 2000) errors.errorExcerpt = "Error excerpt must be 2000 characters or fewer.";
  }
  return errors;
}

export function elementorSummary(diagnostic, findings = []) {
  return {
    id: diagnostic.id,
    websiteId: diagnostic.websiteId,
    symptomCategory: diagnostic.symptomCategory,
    symptomDescription: diagnostic.symptomDescription,
    affectedScope: diagnostic.affectedScope,
    affectedPages: diagnostic.affectedPages,
    deviceScope: diagnostic.deviceScope,
    updatePreceded: diagnostic.updatePreceded,
    startedAt: diagnostic.startedAt,
    errorExcerpt: diagnostic.errorExcerpt,
    status: diagnostic.status,
    snapshotSchemaVersion: diagnostic.snapshotSchemaVersion,
    snapshotReceivedAt: diagnostic.snapshotReceivedAt ? diagnostic.snapshotReceivedAt.toISOString() : null,
    createdAt: diagnostic.createdAt ? diagnostic.createdAt.toISOString() : null,
    completedAt: diagnostic.completedAt ? diagnostic.completedAt.toISOString() : null,
    findings,
  };
}

export function publicFinding(row) {
  return {
    id: row.id,
    ruleId: row.ruleId,
    category: row.category,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    evidence: row.evidence,
    referencedItems: row.referencedItems,
    recommendation: row.recommendation,
    confidence: row.confidence,
    requiredAdditionalEvidence: row.requiredAdditionalEvidence,
  };
}

export async function createElementorDiagnostic(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedElementorLimiter;
  if (limiter && !limiter.check(userId)) {
    throw new ElementorError("RATE_LIMITED", 429);
  }
  const errors = validateSymptom(input);
  if (Object.keys(errors).length > 0) {
    throw new ElementorError("VALIDATION_FAILED", 400, { errors });
  }
  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, userId },
    include: { connection: true },
  });
  if (!website) throw new ElementorError("NOT_FOUND", 404);
  const connection = website.connection;
  if (!connection || connection.status !== "ACTIVE" || website.connectionStatus !== "CONNECTED") {
    throw new ElementorError("SNAPSHOT_MISSING", 422, {
      snapshotStatus: "SNAPSHOT_MISSING",
      resyncInstructions: RESYNC_INSTRUCTIONS,
    });
  }
  const snapshotRow = await prisma.connectorDiagnosticSnapshot.findFirst({
    where: { connectionId: connection.id },
    orderBy: { receivedAt: "desc" },
  });
  const freshness = elementorSnapshotFreshness(snapshotRow, { nowMs: deps.nowMs ?? Date.now() });
  if (freshness.status !== "CURRENT") {
    throw new ElementorError(freshness.status, 422, {
      snapshotStatus: freshness.status,
      resyncInstructions: RESYNC_INSTRUCTIONS,
    });
  }
  // Bounded snapshot COPY: the live snapshot row is replaced on every sync.
  const snapshotPayload = snapshotRow.payload;
  const { findings } = runElementorRules(snapshotPayload, {
    category: input.symptomCategory,
    description: input.symptomDescription,
    affectedScope: input.affectedScope ?? "unknown",
    affectedPages: input.affectedPages ?? "unknown",
    deviceScope: input.deviceScope ?? "unknown",
    updatePreceded: input.updatePreceded ?? null,
    startedAt: input.startedAt ?? null,
    errorExcerpt: input.errorExcerpt ?? null,
  });
  const description = redactSecrets(input.symptomDescription);
  const excerpt = input.errorExcerpt ? redactSecrets(input.errorExcerpt) : null;
  try {
    const diagnostic = await prisma.$transaction(async (tx) => {
      const created = await tx.elementorDiagnostic.create({
        data: {
          userId,
          websiteId: website.id,
          snapshotPayload,
          snapshotSchemaVersion: snapshotRow.schemaVersion,
          snapshotReceivedAt: snapshotRow.receivedAt,
          symptomCategory: input.symptomCategory,
          symptomDescription: description,
          affectedScope: input.affectedScope ?? "unknown",
          affectedPages: input.affectedPages ?? "unknown",
          deviceScope: input.deviceScope ?? "unknown",
          updatePreceded: input.updatePreceded === true ? "TRUE" : input.updatePreceded === false ? "FALSE" : "UNKNOWN",
          startedAt: input.startedAt ? String(input.startedAt) : null,
          errorExcerpt: excerpt,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
      if (findings.length > 0) {
        await tx.elementorDiagnosticFinding.createMany({
          data: findings.map((f) => ({
            diagnosticId: created.id,
            ruleId: f.ruleId,
            category: f.category,
            severity: f.severity,
            status: f.status,
            title: f.title,
            description: f.description,
            evidence: f.evidence ?? {},
            referencedItems: f.referencedItems ?? [],
            recommendation: f.recommendation,
            confidence: f.confidence,
            requiredAdditionalEvidence: f.requiredAdditionalEvidence ?? null,
          })),
        });
      }
      return created;
    });
    const rows = await prisma.elementorDiagnosticFinding.findMany({
      where: { diagnosticId: diagnostic.id },
      orderBy: { createdAt: "asc" },
    });
    return elementorSummary(diagnostic, rows.map(publicFinding));
  } catch {
    throw new ElementorError("DATABASE_OPERATION_FAILED", 500);
  }
}

// Public snapshot view for one owned website: Elementor/Pro status +
// environment limits + freshness. No URLs beyond the website record itself,
// no credentials, no secrets — the snapshot never contains any.
export async function getElementorSnapshotView(userId, websiteId, deps = {}) {
  const website = await prisma.website.findFirst({
    where: { id: websiteId, userId },
    include: { connection: true },
  });
  if (!website) throw new ElementorError("NOT_FOUND", 404);
  const connection = website.connection;
  if (!connection) {
    return {
      websiteId: website.id,
      connected: false,
      connectionStatus: website.connectionStatus,
      snapshotStatus: "SNAPSHOT_MISSING",
      resyncInstructions: RESYNC_INSTRUCTIONS,
      snapshot: null,
    };
  }
  const snapshotRow = await prisma.connectorDiagnosticSnapshot.findFirst({
    where: { connectionId: connection.id },
    orderBy: { receivedAt: "desc" },
  });
  const freshness = elementorSnapshotFreshness(snapshotRow, { nowMs: deps.nowMs ?? Date.now() });
  const payload = snapshotRow?.payload && typeof snapshotRow.payload === "object" ? snapshotRow.payload : null;
  const el = payload?.elementor && typeof payload.elementor === "object" ? payload.elementor : null;
  const env = payload?.environment && typeof payload.environment === "object" ? payload.environment : null;
  return {
    websiteId: website.id,
    connected: connection.status === "ACTIVE" && website.connectionStatus === "CONNECTED",
    connectionStatus: website.connectionStatus,
    snapshotStatus: freshness.status,
    snapshotReceivedAt: freshness.receivedAt ? freshness.receivedAt.toISOString() : null,
    snapshotMaxAgeMs: freshness.maxAgeMs,
    resyncInstructions: freshness.status === "CURRENT" ? null : RESYNC_INSTRUCTIONS,
    snapshot: payload
      ? {
          schemaVersion: payload.schemaVersion,
          wordpressVersion: payload.wordpressVersion ?? null,
          phpVersion: payload.phpVersion ?? null,
          pluginVersion: payload.pluginVersion ?? null,
          themeName: payload.theme?.name ?? null,
          themeVersion: payload.theme?.version ?? null,
          elementor: el
            ? {
                status: el.status ?? "UNKNOWN",
                version: el.version ?? null,
                installed: el.installed ?? null,
                active: el.active ?? null,
                pro: el.pro
                  ? { installed: el.pro.installed ?? null, active: el.pro.active ?? null, version: el.pro.version ?? null }
                  : null,
              }
            : null,
          environment: env
            ? { phpMemoryLimit: env.phpMemoryLimit ?? null, wpMemoryLimit: env.wpMemoryLimit ?? null, maxExecutionTime: env.maxExecutionTime ?? null }
            : null,
        }
      : null,
  };
}
