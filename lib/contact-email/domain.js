// Email-domain validation + default-domain rule (Tool 07, Milestone 11).
// Strict and conservative: a domain must be multi-label, DNS-label-safe,
// not an IP literal, not localhost, and not a single label. The default
// domain rule is documented exactly: take the host of the snapshot homeUrl
// (websiteId path) or the target URL (URL-only path), strip ONE leading
// "www.", and accept it ONLY if it then passes isPublicDomain(). No
// public-suffix derivation, no registrable-domain guessing: if stripping
// www. does not yield a valid multi-label public domain, the domain is
// unknown and DNS checks are INSUFFICIENT_EVIDENCE.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isPublicDomain(value) {
  if (typeof value !== "string") return false;
  const domain = value.trim().toLowerCase();
  if (domain.length < 3 || domain.length > 253) return false;
  if (domain === "localhost" || domain.endsWith(".localhost")) return false;
  if (IPV4_RE.test(domain)) return false;
  if (domain.includes(":")) return false; // IPv6 literal / port remnants
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return false;
  for (const label of labels) {
    if (!LABEL_RE.test(label)) return false;
  }
  return true;
}

export function defaultEmailDomainFromUrl(urlValue) {
  if (typeof urlValue !== "string" || urlValue === "") return null;
  let host;
  try {
    host = new URL(urlValue).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.startsWith("www.")) host = host.slice(4);
  return isPublicDomain(host) ? host : null;
}

export function isValidDkimSelector(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,63}$/.test(value);
}

// Extracts the domain part of a literal email address, or null for
// templates, malformed input, or anything that is not a plain address.
// Never returns a full address.
export function domainFromEmail(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.includes("[") || trimmed.includes("]") || trimmed.includes(" ")) return null;
  const match = /^[^@\s]+@([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,})$/.exec(trimmed);
  if (!match) return null;
  const domain = match[1].toLowerCase();
  return isPublicDomain(domain) ? domain : null;
}
