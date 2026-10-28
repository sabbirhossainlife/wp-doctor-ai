// Scanner URL policy (stricter than M1 website registration on purpose:
// the scanner's port rule lives here only and never weakens M1 rules).
// WHATWG URL parsing + normalization, absolute http/https only, standard
// ports only. A hostname is never trusted because it "looks public" — the
// DNS + IP stages in dns.js decide that.
import { ScannerError } from "./errors.js";

export const SCANNER_MAX_URL_LENGTH = 2048;
const ALLOWED_PORTS = { "http:": "80", "https:": "443" };

// Hostnames the scanner refuses outright, before DNS. Single-label names
// (no dot) are refused because they can resolve via local search domains.
const REFUSED_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "lan",
  "home.arpa",
  "onion",
];

function hasRefusedSuffix(host) {
  if (host === "localhost") return true;
  return REFUSED_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function isValidHostname(host) {
  if (!host || host.length > 253) return false;
  if (host.includes("%") || host.includes("_") || host.includes(" ")) {
    return false;
  }
  // IP literals are validated by the IP stage, not here.
  if (host.startsWith("[") && host.endsWith("]")) return false;
  const labels = host.split(".");
  for (const label of labels) {
    if (!label || label.length > 63) return false;
    if (!/^[A-Za-z0-9-]+$/.test(label)) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }
  return true;
}

// Parse + normalize one scanner target. Returns a target object, or throws
// a ScannerError with a safe code. `baseUrl` is only used for redirect
// Location values (relative redirects); initial scans must pass null.
export function parseScanTarget(input, baseUrl = null) {
  if (typeof input !== "string") {
    throw new ScannerError("INVALID_URL", "non-string input");
  }
  const raw = input.trim();
  if (!raw || raw.length > SCANNER_MAX_URL_LENGTH) {
    throw new ScannerError("INVALID_URL", "empty or overlong input");
  }
  // Reject raw control characters / whitespace inside the URL. WHATWG
  // parsing would otherwise silently strip some of them.
  if (/[\u0000-\u0020\u007f]/.test(raw)) {
    throw new ScannerError("INVALID_URL", "control or space characters");
  }
  let parsed;
  try {
    parsed = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
  } catch {
    throw new ScannerError("INVALID_URL", "unparseable");
  }
  // Relative URLs are only valid as redirects against a base.
  if (!baseUrl && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
    throw new ScannerError("INVALID_URL", "relative url without base");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ScannerError("UNSUPPORTED_SCHEME", parsed.protocol);
  }
  if (parsed.username || parsed.password) {
    throw new ScannerError("INVALID_URL", "embedded credentials");
  }
  // Hostname: WHATWG lowercases + punycode-encodes IDNs + canonicalizes
  // IPv4 forms (0x7f000001, 2130706433, 127.1 -> 127.0.0.1) and IPv6.
  let host = parsed.hostname.toLowerCase();
  // Node's WHATWG parser keeps brackets on IPv6 literals ([::1]); strip
  // them so DNS classification, transport, and logging see the bare address.
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  // Strip a single trailing dot (example.com. == example.com).
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) throw new ScannerError("INVALID_URL", "missing hostname");
  const isIpLiteral = /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(host) || host.includes(":");
  if (!isIpLiteral) {
    if (!isValidHostname(host)) {
      throw new ScannerError("INVALID_URL", "invalid hostname");
    }
    if (hasRefusedSuffix(host)) {
      throw new ScannerError("PROHIBITED_DESTINATION", "refused suffix");
    }
    if (!host.includes(".")) {
      throw new ScannerError("PROHIBITED_DESTINATION", "single-label host");
    }
  }
  const allowedPort = ALLOWED_PORTS[parsed.protocol];
  // WHATWG already drops the default port from parsed.port; any remaining
  // explicit port must equal the scheme default to be accepted.
  if (parsed.port && parsed.port !== allowedPort) {
    throw new ScannerError("UNSUPPORTED_PORT", parsed.port);
  }
  const port = Number(allowedPort);
  // Path + query are the request target; the fragment is never sent.
  const path = parsed.pathname || "/";
  const target = parsed.search ? `${path}${parsed.search}` : path;
  const displayHost = host.includes(":") ? `[${host}]` : host;
  return {
    // Normalized URL without fragment (query retained for the request, but
    // never logged or stored — see logging.js).
    url: `${parsed.protocol}//${displayHost}:${port}${target}`,
    protocol: parsed.protocol,
    hostname: host,
    port,
    path: target,
    isIpLiteral,
  };
}
