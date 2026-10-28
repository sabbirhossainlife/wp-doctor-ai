// Conflict diagnostic service (Milestone 6). Owns the POST lifecycle:
// session user -> ownership in WHERE -> CONNECTED + ACTIVE connection ->
// latest snapshot -> freshness/schema gates -> deterministic engine ->
// persist diagnostic + findings. Blocked runs persist NOTHING and return
// a 422 payload with re-sync instructions (documented decision).
// Only websiteId, symptomCategory, symptomDescription, errorExcerpt are
// ever read from client input; any client snapshot/connectorId/ownerId
// is ignored by the route before it reaches this service.

import { prisma } from "../prisma.js";
import { runConflictRules } from "./engine.js";
import { snapshotFreshness, RESYNC_INSTRUCTIONS } from "./freshness.js";
import { redactSecrets } from "./redact.js";
import { sharedConflictLimiter } from "./rate-limit.js";

export const SYMPTOM_CATEGORIES = [
  "UPDATE_ERROR",
  "FRONTEND_BROKEN",
  "ADMIN_ERROR",
  "EDITOR_FAILURE",
  "FEATURE_NOT_WORKING",
  "THEME_LAYOUT",
  "PHP_COMPAT_WARNING",
  "OTHER",
  "UNKNOWN",
];

export const RESYNC_MESSAGE = RESYNC_INSTRUCTIONS;

export class ConflictError extends Error {
  constructor(code, status, payload = {}) {
    super(code);
    this.name = "ConflictError";
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

function validateSymptom({ symptomCategory, symptomDescription, errorExcerpt }) {
  const errors = {};
  if (!SYMPTOM_CATEGORIES.includes(symptomCategory)) {
    errors.symptomCategory = "Choose a symptom category.";
  }
  if (typeof symptomDescription !== "string" || symptomDescription.trim().length === 0) {
    errors.symptomDescription = "Describe the symptom.";
  } else if (symptomDescription.length > 2000) {
    errors.symptomDescription = "Description must be 2000 characters or fewer.";
  }
  if (errorExcerpt !== undefined && errorExcerpt !== null && errorExcerpt !== "") {
    if (typeof errorExcerpt !== "string") errors.errorExcerpt = "Error excerpt must be text.";
    else if (errorExcerpt.length > 2000) errors.errorExcerpt = "Error excerpt must be 2000 characters or fewer.";
  }
  return errors;
}

export function conflictSummary(diagnostic, findings = []) {
  return {
    id: diagnostic.id,
    websiteId: diagnostic.websiteId,
    symptomCategory: diagnostic.symptomCategory,
    symptomDescription: diagnostic.symptomDescription,
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

// deps: { limiter, nowMs } — injectable for tests; production uses shared.
export async function createConflictDiagnostic(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedConflictLimiter;
  if (limiter && !limiter.check(userId)) {
    throw new ConflictError("RATE_LIMITED", 429);
  }
  const errors = validateSymptom(input);
  if (Object.keys(errors).length > 0) {
    throw new ConflictError("VALIDATION_FAILED", 400, { errors });
  }
  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, userId },
    include: { connection: true },
  });
  if (!website) throw new ConflictError("NOT_FOUND", 404);
  const connection = website.connection;
  if (!connection || connection.status !== "ACTIVE" || website.connectionStatus !== "CONNECTED") {
    throw new ConflictError("SNAPSHOT_MISSING", 422, {
      snapshotStatus: "SNAPSHOT_MISSING",
      resyncInstructions: RESYNC_INSTRUCTIONS,
    });
  }
  const snapshotRow = await prisma.connectorDiagnosticSnapshot.findFirst({
    where: { connectionId: connection.id },
    orderBy: { receivedAt: "desc" },
  });
  const freshness = snapshotFreshness(snapshotRow, { nowMs: deps.nowMs ?? Date.now() });
  if (freshness.status !== "CURRENT") {
    // Blocked: no diagnostic row is persisted for this run.
    throw new ConflictError(freshness.status, 422, {
      snapshotStatus: freshness.status,
      resyncInstructions: RESYNC_INSTRUCTIONS,
    });
  }
  // Bounded snapshot COPY: the live snapshot row is replaced on every sync
  // (latest-only model), so the diagnostic stores what it analysed against.
  const snapshotPayload = snapshotRow.payload;
  const { findings } = runConflictRules(snapshotPayload, {
    category: input.symptomCategory,
    description: input.symptomDescription,
  });
  const description = redactSecrets(input.symptomDescription);
  const excerpt = input.errorExcerpt ? redactSecrets(input.errorExcerpt) : null;
  try {
    const diagnostic = await prisma.$transaction(async (tx) => {
      const created = await tx.conflictDiagnostic.create({
        data: {
          userId,
          websiteId: website.id,
          snapshotPayload,
          snapshotSchemaVersion: snapshotRow.schemaVersion,
          snapshotReceivedAt: snapshotRow.receivedAt,
          symptomCategory: input.symptomCategory,
          symptomDescription: description,
          errorExcerpt: excerpt,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
      if (findings.length > 0) {
        await tx.conflictFinding.createMany({
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
    const rows = await prisma.conflictFinding.findMany({
      where: { diagnosticId: diagnostic.id },
      orderBy: { createdAt: "asc" },
    });
    return conflictSummary(diagnostic, rows.map(publicFinding));
  } catch {
    throw new ConflictError("DATABASE_OPERATION_FAILED", 500);
  }
}

// Public snapshot view for one owned website: versions, inventory, theme,
// update metadata, freshness. No URLs, no credentials, no secrets.
export async function getSnapshotView(userId, websiteId, deps = {}) {
  const website = await prisma.website.findFirst({
    where: { id: websiteId, userId },
    include: { connection: true },
  });
  if (!website) throw new ConflictError("NOT_FOUND", 404);
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
  const freshness = snapshotFreshness(snapshotRow, { nowMs: deps.nowMs ?? Date.now() });
  const payload = snapshotRow?.payload && typeof snapshotRow.payload === "object" ? snapshotRow.payload : null;
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
          multisite: payload.multisite ?? false,
          locale: payload.locale ?? null,
          activePlugins: payload.activePlugins ?? [],
          activeTheme: payload.activeTheme ?? null,
          plugins: payload.plugins ?? null,
          theme: payload.theme ?? null,
        }
      : null,
  };
}
