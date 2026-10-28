// Tool 10 explicit confirmation. Destructive operations require the user
// to TYPE a phrase containing the destination's canonical hostname; the
// server validates it independently (never a client boolean). A
// short-lived one-use authorization token is then issued, bound to the
// exact plan hash — any plan/target change invalidates it.
import { sha256Hex, hashSecretValue } from "./crypto.js";
import { canonicalJson } from "./manifest.js";
export function expectedConfirmationPhrase(operationType, canonicalHost) {
  if (operationType === "RESTORE") return `RESTORE TO ${canonicalHost}`;
  if (operationType === "MIGRATION") return `MIGRATE TO ${canonicalHost}`;
  if (operationType === "DELETE_BACKUP") return `DELETE BACKUP ${canonicalHost}`;
  return null;
}
export function planHash(plan) {
  return sha256Hex(canonicalJson(plan ?? {}));
}
export function confirmationBinding({ userId, sourceWebsiteId, destinationWebsiteId, operationType, backupId, planHash: hash }) {
  return { userId, sourceWebsiteId: sourceWebsiteId ?? null, destinationWebsiteId, operationType, backupId: backupId ?? null, planHash: hash };
}
export function verifyConfirmationToken({ stored, token, binding, nowMs = Date.now() }) {
  if (!stored || !token) return { ok: false, error: "CONFIRMATION_INVALID" };
  if (stored.usedAt) return { ok: false, error: "CONFIRMATION_REPLAYED" };
  if (stored.expiresAt <= nowMs) return { ok: false, error: "CONFIRMATION_EXPIRED" };
  if (stored.tokenHash !== hashSecretValue(token)) return { ok: false, error: "CONFIRMATION_INVALID" };
  const fields = ["userId", "sourceWebsiteId", "destinationWebsiteId", "operationType", "backupId", "planHash"];
  for (const field of fields) {
    if ((stored.binding?.[field] ?? null) !== (binding?.[field] ?? null)) return { ok: false, error: "CONFIRMATION_TARGET_MISMATCH" };
  }
  return { ok: true };
}
