// Shared HTTP mapping for Tool 10 routes. BackupError carries its own
// status; anything else is a generic 500 with no internals leaked.
import { NextResponse } from "next/server";
import { BackupError } from "./service.js";
export function backupErrorResponse(err) {
  if (err instanceof BackupError) {
    const messages = {
      RATE_LIMITED: "Too many backup operations. Try again later.",
      VALIDATION_FAILED: "Invalid backup request.",
      WEBSITE_NOT_FOUND: "Website not found.",
      NOT_FOUND: "Backup record not found.",
      INVALID_STATE_TRANSITION: "This operation cannot move to that state.",
      STORAGE_UNAVAILABLE: "Backup storage or encryption is not configured; the operation is blocked.",
      BACKUP_NOT_VERIFIED: "The backup is not verified.",
      BACKUP_IN_USE: "This backup is required by an active operation and cannot be deleted yet.",
      DOWNLOAD_TOKEN_INVALID: "The download authorization is invalid or expired.",
      DECRYPTION_FAILED: "The stored backup could not be decrypted or verified.",
      VERIFICATION_FAILED: "Backup verification failed.",
      CONFIRMATION_PLAN_CHANGED: "The plan changed after confirmation; a new confirmation is required.",
      DELETE_FAILED: "Backup deletion could not be verified.",
    };
    return NextResponse.json({ error: messages[err.code] || "Backup operation failed.", code: err.code, errors: err.payload?.errors ?? undefined }, { status: err.status || 500 });
  }
  return NextResponse.json({ error: "Backup operation failed." }, { status: 500 });
}
export async function readJson(request, maxBytes = 10 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new BackupError("VALIDATION_FAILED", 413);
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new BackupError("VALIDATION_FAILED", 400); }
}
