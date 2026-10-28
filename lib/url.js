/**
 * Generic URL scheme check.
 * This is a small shared utility for the app shell only — it is NOT the
 * diagnostic scanner (that arrives in Milestone 2/3 with SSRF defenses).
 * Returns true only for http: and https: URLs with a hostname.
 */
export function isHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.hostname.length > 0
  );
}
