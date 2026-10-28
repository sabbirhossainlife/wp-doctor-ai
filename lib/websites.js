// Pure website URL normalization + validation. No I/O, no outbound requests.
// Used by both the API routes and the unit tests.

export function normalizeWebsiteUrl(input) {
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
  // Never accept embedded credentials (user:pass@host) in a registered URL.
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;
  const host = parsed.hostname.toLowerCase();
  // Strip default ports so https://example.com and https://example.com:443
  // are not treated as different websites.
  const isDefaultPort =
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80");
  const port = parsed.port && !isDefaultPort ? `:${parsed.port}` : "";
  // Drop fragment; drop trailing slashes from the path. A root URL keeps no
  // trailing slash (https://example.com, not https://example.com/).
  const path = parsed.pathname.replace(/\/+$/, "");
  const search = parsed.search || "";
  return `${parsed.protocol}//${host}${port}${path}${search}`;
}

export function validateWebsiteInput({ name, url }) {
  const errors = {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) errors.name = "Enter a name for this website.";
  else if (cleanName.length > 100)
    errors.name = "Name must be 100 characters or fewer.";
  const normalizedUrl = normalizeWebsiteUrl(url);
  if (!normalizedUrl) {
    errors.url =
      "Enter a valid http:// or https:// URL without embedded credentials.";
  }
  return { errors, name: cleanName, normalizedUrl };
}

export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8)
    return "Password must be at least 8 characters.";
  if (password.length > 128)
    return "Password must be 128 characters or fewer.";
  return null;
}
