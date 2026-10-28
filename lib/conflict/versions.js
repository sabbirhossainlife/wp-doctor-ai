// Version comparison for the deterministic conflict engine (Milestone 6).
// Pure functions, no I/O. Numeric segments compare numerically; a version
// with a pre-release suffix (alpha/beta/rc/dev) is LOWER than the same
// version without one. Malformed versions return null — callers skip the
// affected rule with a recorded reason instead of comparing alphabetically
// (alphabetical compare would wrongly rank "10.0" below "9.0").

const PRE_RELEASE_RANK = { dev: 0, alpha: 1, beta: 2, rc: 3 };

// Parses "1.2.3", "1.2.3-beta1", "6.8", "8.3.6" into { segments, pre }.
// Returns null for anything malformed: empty, non-numeric segments,
// trailing junk, or an unknown pre-release tag.
export function parseVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Optional leading "v" (e.g. "v1.2") is tolerated; anything else must be
  // digits, dots, and at most one pre-release suffix.
  const match = /^v?(\d+(?:\.\d+)*)(?:[-.](alpha|beta|rc|dev)(\d*))?$/i.exec(trimmed);
  if (!match) return null;
  const segments = match[1].split(".").map((s) => Number.parseInt(s, 10));
  if (segments.some((n) => !Number.isFinite(n))) return null;
  const pre = match[2]
    ? { rank: PRE_RELEASE_RANK[match[2].toLowerCase()], num: match[3] ? Number.parseInt(match[3], 10) : 0 }
    : null;
  return { segments, pre };
}

// Returns -1, 0, 1, or null when either side is malformed.
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.segments.length, pb.segments.length);
  for (let i = 0; i < len; i++) {
    const x = pa.segments[i] ?? 0;
    const y = pb.segments[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1; // release > pre-release
  if (pb.pre === null) return -1;
  if (pa.pre.rank !== pb.pre.rank) return pa.pre.rank < pb.pre.rank ? -1 : 1;
  if (pa.pre.num !== pb.pre.num) return pa.pre.num < pb.pre.num ? -1 : 1;
  return 0;
}

// True when observed < required (i.e. the requirement is NOT met).
// Null when either version is malformed.
export function isBelowMinimum(observed, required) {
  const cmp = compareVersions(observed, required);
  return cmp === null ? null : cmp < 0;
}
