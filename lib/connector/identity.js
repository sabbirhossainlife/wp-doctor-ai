// Canonical site-identity comparison for pairing/diagnostics.
// Policy (documented in docs/connector.md): lowercase host, strip
// trailing slashes from the path, strip default ports, drop query
// strings and fragments, reject embedded credentials and non-http(s)
// schemes. This is intentionally stricter than M1 website registration
// (which preserves the query); both sides are canonicalized with THIS
// function before comparison, so a registered URL with a query still
// matches a claimed home/site URL without it.
// Returns the canonical string, or null if the input is not a usable
// http(s) site URL.
export function canonicalizeSiteUrl(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;
  const host = parsed.hostname.toLowerCase();
  const isDefaultPort =
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80");
  const port = parsed.port && !isDefaultPort ? `:${parsed.port}` : "";
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${host}${port}${path}`;
}

// A claimed WordPress installation matches the registered Website iff
// the registered URL equals the canonical claimed home URL OR the
// canonical claimed site URL. This handles subdirectory installs
// (home != site) without treating the two as interchangeable elsewhere:
// either claimed value matching is sufficient, neither is rewritten.
export function siteIdentityMatches(registeredUrl, homeUrl, siteUrl) {
  const registered = canonicalizeSiteUrl(registeredUrl);
  if (!registered) return false;
  const home = canonicalizeSiteUrl(homeUrl);
  const site = canonicalizeSiteUrl(siteUrl);
  return registered === home || registered === site;
}
