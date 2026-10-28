// WooCommerce diagnostic service (Milestone 7). Mirrors Tool 02's service:
// session user -> ownership in WHERE -> CONNECTED + ACTIVE connection ->
// latest snapshot -> freshness/schema gates -> deterministic engine ->
// persist diagnostic + findings. Blocked runs persist NOTHING and return
// a 422 payload with re-sync instructions. Only websiteId, symptomCategory,
// symptomDescription, checkoutType, affectedScope, startedAt, errorExcerpt
// are ever read from client input; any client snapshot/gateway config/
// payment status/connectorId/ownerId is ignored by the route before it
// reaches this service.
import { prisma } from "../prisma.js";
import { runWooRules } from "./engine.js";
import { wooSnapshotFreshness, RESYNC_INSTRUCTIONS } from "./freshness.js";
import { redactSecrets } from "../conflict/redact.js";
import { sharedWooLimiter } from "./rate-limit.js";

export const SYMPTOM_CATEGORIES = [
  "NO_PAYMENT_METHODS",
  "CHECKOUT_PAGE_MISSING",
  "CHECKOUT_FAILS_TO_LOAD",
  "CHECKOUT_STUCK_LOADING",
  "PAYMENT_INIT_ERROR",
  "PAYMENT_DECLINED_OR_FAILED",
  "ORDER_PENDING",
  "ORDER_NOT_CREATED",
  "SHIPPING_OR_TAX",
  "BLOCK_COMPAT_SUSPECTED",
  "AFTER_UPDATE",
  "OTHER",
  "UNKNOWN",
];

export const CHECKOUT_TYPES = ["BLOCK", "CLASSIC", "UNKNOWN"];
export const AFFECTED_SCOPES = ["ONE", "MULTIPLE", "UNKNOWN"];
export const RESYNC_MESSAGE = RESYNC_INSTRUCTIONS;

export class WooCommerceError extends Error {
  constructor(code, status, payload = {}) {
    super(code);
    this.name = "WooCommerceError";
    this.code = code;
    this.status = status;
    this.payload = payload;
  }
}

function validateSymptom({ symptomCategory, symptomDescription, checkoutType, affectedScope, startedAt, errorExcerpt }) {
  const errors = {};
  if (!SYMPTOM_CATEGORIES.includes(symptomCategory)) errors.symptomCategory = "Choose a symptom category.";
  if (typeof symptomDescription !== "string" || symptomDescription.trim().length === 0) {
    errors.symptomDescription = "Describe the symptom.";
  } else if (symptomDescription.length > 2000) {
    errors.symptomDescription = "Description must be 2000 characters or fewer.";
  }
  if (checkoutType !== undefined && checkoutType !== null && !CHECKOUT_TYPES.includes(checkoutType)) {
    errors.checkoutType = "Checkout type must be block, classic, or unknown.";
  }
  if (affectedScope !== undefined && affectedScope !== null && !AFFECTED_SCOPES.includes(affectedScope)) {
    errors.affectedScope = "Affected scope must be one, multiple, or unknown.";
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

export function wooSummary(diagnostic, findings = []) {
  return {
    id: diagnostic.id,
    websiteId: diagnostic.websiteId,
    symptomCategory: diagnostic.symptomCategory,
    symptomDescription: diagnostic.symptomDescription,
    checkoutType: diagnostic.checkoutType,
    affectedScope: diagnostic.affectedScope,
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

export async function createWooCommerceDiagnostic(userId, input, deps = {}) {
  const limiter = deps.limiter !== undefined ? deps.limiter : sharedWooLimiter;
  if (limiter && !limiter.check(userId)) {
    throw new WooCommerceError("RATE_LIMITED", 429);
  }
  const errors = validateSymptom(input);
  if (Object.keys(errors).length > 0) {
    throw new WooCommerceError("VALIDATION_FAILED", 400, { errors });
  }
  const website = await prisma.website.findFirst({
    where: { id: input.websiteId, userId },
    include: { connection: true },
  });
  if (!website) throw new WooCommerceError("NOT_FOUND", 404);
  const connection = website.connection;
  if (!connection || connection.status !== "ACTIVE" || website.connectionStatus !== "CONNECTED") {
    throw new WooCommerceError("SNAPSHOT_MISSING", 422, {
      snapshotStatus: "SNAPSHOT_MISSING",
      resyncInstructions: RESYNC_INSTRUCTIONS,
    });
  }
  const snapshotRow = await prisma.connectorDiagnosticSnapshot.findFirst({
    where: { connectionId: connection.id },
    orderBy: { receivedAt: "desc" },
  });
  const freshness = wooSnapshotFreshness(snapshotRow, { nowMs: deps.nowMs ?? Date.now() });
  if (freshness.status !== "CURRENT") {
    throw new WooCommerceError(freshness.status, 422, {
      snapshotStatus: freshness.status,
      resyncInstructions: RESYNC_INSTRUCTIONS,
    });
  }
  // Bounded snapshot COPY: the live snapshot row is replaced on every sync.
  const snapshotPayload = snapshotRow.payload;
  const { findings } = runWooRules(snapshotPayload, {
    category: input.symptomCategory,
    description: input.symptomDescription,
    checkoutType: input.checkoutType ?? "UNKNOWN",
    affectedScope: input.affectedScope ?? "UNKNOWN",
  });
  const description = redactSecrets(input.symptomDescription);
  const excerpt = input.errorExcerpt ? redactSecrets(input.errorExcerpt) : null;
  try {
    const diagnostic = await prisma.$transaction(async (tx) => {
      const created = await tx.wooCommerceDiagnostic.create({
        data: {
          userId,
          websiteId: website.id,
          snapshotPayload,
          snapshotSchemaVersion: snapshotRow.schemaVersion,
          snapshotReceivedAt: snapshotRow.receivedAt,
          symptomCategory: input.symptomCategory,
          symptomDescription: description,
          checkoutType: input.checkoutType ?? "UNKNOWN",
          affectedScope: input.affectedScope ?? "UNKNOWN",
          startedAt: input.startedAt ? String(input.startedAt) : null,
          errorExcerpt: excerpt,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
      if (findings.length > 0) {
        await tx.wooCommerceDiagnosticFinding.createMany({
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
    const rows = await prisma.wooCommerceDiagnosticFinding.findMany({
      where: { diagnosticId: diagnostic.id },
      orderBy: { createdAt: "asc" },
    });
    return wooSummary(diagnostic, rows.map(publicFinding));
  } catch {
    throw new WooCommerceError("DATABASE_OPERATION_FAILED", 500);
  }
}

// Public snapshot view for one owned website: WooCommerce summary only.
// Versions, page configuration, gateway ids/titles/enabled/block-compat,
// freshness. No URLs beyond the website record itself, no credentials,
// no secrets — the snapshot never contains any.
export async function getWooSnapshotView(userId, websiteId, deps = {}) {
  const website = await prisma.website.findFirst({
    where: { id: websiteId, userId },
    include: { connection: true },
  });
  if (!website) throw new WooCommerceError("NOT_FOUND", 404);
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
  const freshness = wooSnapshotFreshness(snapshotRow, { nowMs: deps.nowMs ?? Date.now() });
  const payload = snapshotRow?.payload && typeof snapshotRow.payload === "object" ? snapshotRow.payload : null;
  const woo = payload?.woocommerce && typeof payload.woocommerce === "object" ? payload.woocommerce : null;
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
          woocommerce: woo
            ? {
                status: woo.status ?? "UNKNOWN",
                version: woo.version ?? null,
                installed: woo.installed ?? null,
                active: woo.active ?? null,
                pages: woo.pages ?? null,
                gateways: Array.isArray(woo.gateways)
                  ? woo.gateways.map((g) => ({
                      id: g?.id ?? null, title: g?.title ?? null, enabled: g?.enabled ?? null,
                      blockCompatibility: g?.blockCompatibility ?? "UNKNOWN",
                    }))
                  : [],
              }
            : null,
        }
      : null,
  };
}
