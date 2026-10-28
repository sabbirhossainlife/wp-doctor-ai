// Tool 10 archive path safety. Only relative, forward-slash paths inside
// the target WordPress root are ever accepted. Absolute paths, drive
// letters, NUL, ".." escapes, backslashes, symlinks, devices/special
// files, and duplicate/conflicting entries are rejected outright —
// extraction never runs on an unvalidated entry list.
import path from "node:path";
const UNSAFE_NAMES = new Set([".", ".."]); // empty segments collapse under normalize; "." / ".." never do
export function validateRelativePath(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024) return { ok: false, error: "INVALID_PATH" };
  if (raw.includes("\0") || raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return { ok: false, error: "INVALID_PATH" };
  const parts = raw.split("/");
  for (const part of parts) {
    if (UNSAFE_NAMES.has(part)) return { ok: false, error: "PATH_TRAVERSAL" };
  }
  const normalized = path.posix.normalize(raw);
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) return { ok: false, error: "PATH_TRAVERSAL" };
  return { ok: true, path: normalized };
}
export function validateArchiveEntries(entries, limits) {
  const errors = [];
  const seen = new Set();
  let totalExpanded = 0;
  if (!Array.isArray(entries)) return { ok: false, errors: ["ENTRIES_NOT_ARRAY"] };
  if (entries.length > limits.maxFilesPerArchive) errors.push("FILE_COUNT_LIMIT");
  for (const entry of entries) {
    if (!entry || typeof entry.path !== "string") { errors.push("INVALID_ENTRY"); continue; }
    const v = validateRelativePath(entry.path);
    if (!v.ok) { errors.push(`${v.error}:${entry.path.slice(0, 80)}`); continue; }
    if (seen.has(v.path)) errors.push(`DUPLICATE_PATH:${v.path}`);
    seen.add(v.path);
    if (entry.symlink) errors.push(`SYMLINK_REJECTED:${v.path}`);
    if (entry.special) errors.push(`SPECIAL_FILE_REJECTED:${v.path}`);
    if (typeof entry.size === "number") {
      if (entry.size > limits.maxFileBytes) errors.push(`FILE_TOO_LARGE:${v.path}`);
      totalExpanded += entry.size;
    }
  }
  if (totalExpanded > limits.maxExpandedBytes) errors.push("EXPANDED_SIZE_LIMIT");
  return { ok: errors.length === 0, errors, totalExpandedBytes: totalExpanded, fileCount: seen.size };
}
// Trusted WP file scope for FILES_ONLY / SITE_DATA_BACKUP. Anything
// outside this list is never collected by the connector and never
// restored by this tool. wp-config.php is NOT in this scope by default.
export const BACKUP_FILE_SCOPE = Object.freeze([
  "wp-admin", "wp-includes", "wp-content/plugins", "wp-content/themes",
  "wp-content/mu-plugins", "wp-content/uploads", "wp-content/languages",
]);
export function isInBackupScope(relativePath) {
  const v = validateRelativePath(relativePath);
  if (!v.ok) return false;
  const p = v.path;
  if (p === "wp-config.php") return false; // sensitive: opt-in same-site only, handled separately
  if (!p.includes("/")) return true; // root install files (index.php, wp-load.php, ...)
  return BACKUP_FILE_SCOPE.some((scope) => p === scope || p.startsWith(scope + "/"));
}
