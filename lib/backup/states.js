// Tool 10 operation state machine (Milestone 14). States are persisted
// in BackupOperation.state; transitions are enforced here and in the
// service — an invalid transition is rejected, never silently coerced.
// No percentage progress is ever derived from these states: the UI
// shows only the persisted state word plus bounded counts.
export const BACKUP_STATES = Object.freeze([
  "DRAFT", "PREFLIGHT", "AWAITING_CONFIRMATION", "QUEUED", "RUNNING",
  "VERIFYING", "COMPLETED", "PARTIAL", "FAILED", "BLOCKED", "CANCELLED",
  "FAILED_REQUIRES_REVIEW",
]);
export const TERMINAL_STATES = Object.freeze([
  "COMPLETED", "PARTIAL", "FAILED", "BLOCKED", "CANCELLED", "FAILED_REQUIRES_REVIEW",
]);
const TRANSITIONS = {
  DRAFT: ["PREFLIGHT", "CANCELLED", "BLOCKED"],
  PREFLIGHT: ["AWAITING_CONFIRMATION", "QUEUED", "BLOCKED", "FAILED", "CANCELLED"],
  AWAITING_CONFIRMATION: ["QUEUED", "RUNNING", "BLOCKED", "CANCELLED", "FAILED"],
  QUEUED: ["RUNNING", "BLOCKED", "CANCELLED", "FAILED"],
  RUNNING: ["VERIFYING", "PARTIAL", "FAILED", "FAILED_REQUIRES_REVIEW", "BLOCKED", "CANCELLED"],
  VERIFYING: ["COMPLETED", "PARTIAL", "FAILED", "FAILED_REQUIRES_REVIEW", "BLOCKED"],
  COMPLETED: [], PARTIAL: [], FAILED: [], BLOCKED: [], CANCELLED: [], FAILED_REQUIRES_REVIEW: [],
};
export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}
export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const err = new Error(`INVALID_STATE_TRANSITION:${from}->${to}`);
    err.code = "INVALID_STATE_TRANSITION"; throw err;
  }
}
export const BACKUP_MODES = Object.freeze(["DATABASE_ONLY", "FILES_ONLY", "SITE_DATA_BACKUP"]);
export const OPERATION_TYPES = Object.freeze(["BACKUP", "RESTORE", "MIGRATION"]);
// A destructive (target-mutating) job in a non-terminal state blocks any
// other destructive job for the same destination website.
export function isDestructive(type) { return type === "RESTORE" || type === "MIGRATION"; }
