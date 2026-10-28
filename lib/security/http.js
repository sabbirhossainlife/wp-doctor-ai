// Tool 08 passive HTTP security observations (Milestone 12). All requests
// go through the M2 pinned components — parseScanTarget (URL policy),
// resolveAndValidate (DNS + fail-closed IP policy), pinnedRequest (pinned
// transport, rejectUnauthorized never disabled). No second network stack,
// no unrestricted fetch, no credentials, no POST, no payloads, no auth.
// Every request is a plain unauthenticated GET of a public URL path.
// Redirects are followed ONLY to the same hostname, max 3 hops; a
// cross-host redirect stops that check with a recorded redirect note
// (the redirect destination is never fetched). Per-scan request cap: 30.
// The httpProbe dependency (injected in tests) must return the same shape
// as probeUrl: { status, headers, bodyPreview? , error? , redirectedTo? }.
// Sensitive-path bodies: at most 4 KiB is ever captured, it is classified
// immediately in classifySensitivePath, and it is NEVER returned to the
// caller or persisted — probeSensitivePaths returns classifications only.
import { parseScanTarget } from "../scanner/url-policy.js";
import { resolveAndValidate } from "../scanner/dns.js";
import { pinnedRequest } from "../scanner/transport.js";

export const SECURITY_HTTP_LIMITS = Object.freeze({
  maxRequestsPerScan: 30,
  maxRedirectsPerCheck: 3,
  sensitiveBodyCaptureBytes: 4096,
  sensitiveProbeMaxBytes: 64 * 1024,
  probeTimeoutMs: 10000,
});

export const SENSITIVE_PATHS = Object.freeze([
  "/.env",
  "/.git/HEAD",
  "/wp-config.php.bak",
  "/wp-config.php~",
  "/wp-content/debug.log",
  "/debug.log",
]);

const SECRET_LIKE = /(DB_PASSWORD|DB_USER|AUTH_KEY|SECURE_AUTH_KEY|LOGGED_IN_KEY|NONCE_KEY|WP_.*_KEY|WP_.*_SALT|api[_-]?key|secret|password)\s*[:=]\s*\S+/i;

// Per-path confirmed-exposure signatures. A signature match on a 200
// response is the ONLY route to SENSITIVE_FILE_EXPOSURE_CONFIRMED. A 200
// without a signature is POSSIBLE_EXPOSURE; a non-200 is NOT_OBSERVED
// (with the standing limitation that 403/404 alone do not prove absence).
function pathSignature(path, body) {
  if (typeof body !== "string" || body.length === 0) return false;
  if (path === "/.env") return /^\s*(DB_PASSWORD|DB_USER|DB_NAME|DB_HOST|AUTH_KEY|SECURE_AUTH_KEY|WP_HOME|WP_SITEURL)\s*=/m.test(body);
  if (path === "/.git/HEAD") return /^ref:\s*refs\/heads\//m.test(body);
  if (path === "/wp-config.php.bak" || path === "/wp-config.php~") {
    return /<\?php/.test(body) && /(DB_PASSWORD|define\s*\(\s*['"]DB_)/.test(body);
  }
  if (path === "/wp-content/debug.log" || path === "/debug.log") {
    return /(PHP (Fatal|Warning|Notice)|Stack trace:|WordPress database error)/.test(body);
  }
  return false;
}

// Classifies a sensitive-path probe result. `body` is consumed here and
// never leaves this function. Returns a sanitized classification only.
export function classifySensitivePath(path, result) {
  const base = { path, status: result?.status ?? null, contentTypeCategory: contentTypeCategory(result?.headers?.["content-type"]) };
  if (result?.error) return { ...base, result: "NOT_RUN", reason: result.error };
  if (result?.status !== 200) return { ...base, result: "NOT_OBSERVED", reason: `HTTP_${result?.status}` };
  const body = typeof result?.bodyPreview === "string" ? result.bodyPreview : "";
  if (pathSignature(path, body) || SECRET_LIKE.test(body)) {
    return { ...base, result: "CONFIRMED", reason: "SIGNATURE_MATCH" };
  }
  return { ...base, result: "POSSIBLE_EXPOSURE", reason: "HTTP_200_NO_SIGNATURE" };
}

function contentTypeCategory(raw) {
  if (typeof raw !== "string") return null;
  if (raw.includes("text/html")) return "text/html";
  if (raw.includes("text/plain")) return "text/plain";
  if (raw.includes("application/json")) return "application/json";
  return "other";
}

function joinPath(baseUrl, path) {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.host}${path}`;
}

// Real pinned probe: parse + DNS-validate + pinned GET. `captureBody`
// enables the bounded first-bytes capture (sensitive paths only).
export async function probeUrl(url, { captureBody = false } = {}) {
  const target = parseScanTarget(url);
  const { chosen } = await resolveAndValidate(target, {});
  const res = await pinnedRequest({
    protocol: target.protocol,
    hostname: target.hostname,
    ip: chosen.address,
    family: chosen.family,
    port: target.port,
    path: target.path,
    timeoutMs: SECURITY_HTTP_LIMITS.probeTimeoutMs,
    maxBytes: captureBody ? SECURITY_HTTP_LIMITS.sensitiveProbeMaxBytes : 256 * 1024,
    ...(captureBody ? { captureBodyBytes: SECURITY_HTTP_LIMITS.sensitiveBodyCaptureBytes } : {}),
  });
  return { status: res.status, headers: res.headers ?? {}, bodyPreview: res.bodyPreview ?? null };
}

// Homepage probe with same-host redirect following. Returns
// { finalUrl, status, headers, redirectCount, crossHostRedirect, error }.
// Headers are the final response's headers (lowercased keys from the
// transport). On any failure the check is NOT_RUN, never a clean claim.
export async function probeHomepage(baseUrl, { probe = probeUrl, maxRedirects = SECURITY_HTTP_LIMITS.maxRedirectsPerCheck } = {}) {
  let current = baseUrl;
  let redirectCount = 0;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await probe(current);
      if (res.error) return { finalUrl: current, status: null, headers: {}, redirectCount, crossHostRedirect: false, error: res.error };
      const status = res.status;
      const location = res.headers?.location ?? res.headers?.Location ?? null;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        let next;
        try { next = new URL(location, current).toString(); } catch { return { finalUrl: current, status, headers: res.headers, redirectCount, crossHostRedirect: false, error: "INVALID_REDIRECT" }; }
        if (new URL(next).hostname !== new URL(current).hostname) {
          return { finalUrl: current, status, headers: res.headers, redirectCount, crossHostRedirect: true, redirectTo: null, error: null };
        }
        if (hop === maxRedirects) return { finalUrl: current, status, headers: res.headers, redirectCount, crossHostRedirect: false, error: "TOO_MANY_REDIRECTS" };
        current = next;
        redirectCount += 1;
        continue;
      }
      return { finalUrl: current, status, headers: res.headers ?? {}, redirectCount, crossHostRedirect: false, error: null };
    }
    return { finalUrl: current, status: null, headers: {}, redirectCount, crossHostRedirect: false, error: "TOO_MANY_REDIRECTS" };
  } catch (err) {
    return { finalUrl: current, status: null, headers: {}, redirectCount, crossHostRedirect: false, error: String(err?.code ?? err?.message ?? "PROBE_FAILED").slice(0, 100) };
  }
}

export async function probeXmlrpc(baseUrl, { probe = probeUrl } = {}) {
  try {
    const res = await probe(joinPath(baseUrl, "/xmlrpc.php"));
    if (res.error) return { status: null, responds: false, error: res.error };
    // WP's xmlrpc.php answers GET with 200 or 405 ("POST only"). Either
    // means the endpoint responds unauthenticated. 404/403 mean not
    // observed (not proof of absence — see rules limitations).
    return { status: res.status, responds: res.status === 200 || res.status === 405, error: null };
  } catch (err) {
    return { status: null, responds: false, error: String(err?.code ?? err?.message ?? "PROBE_FAILED").slice(0, 100) };
  }
}

export async function probeSensitivePaths(baseUrl, { probe = probeUrl } = {}) {
  const results = [];
  let count = 0;
  for (const path of SENSITIVE_PATHS) {
    count += 1;
    if (count > SECURITY_HTTP_LIMITS.maxRequestsPerScan) break;
    try {
      const res = await probe(joinPath(baseUrl, path), { captureBody: true });
      results.push(classifySensitivePath(path, res));
    } catch (err) {
      results.push({ path, status: null, contentTypeCategory: null, result: "NOT_RUN", reason: String(err?.code ?? err?.message ?? "PROBE_FAILED").slice(0, 100) });
    }
  }
  return results;
}

// Full passive observation set for one scan. httpProbe (tests) replaces
// probeUrl wholesale; production passes no override. Request counting is
// enforced by the fixed path list + homepage redirect cap (<= 30 total).
export async function runPassiveHttpChecks(baseUrl, { probe = probeUrl } = {}) {
  const homepage = await probeHomepage(baseUrl, { probe });
  const xmlrpc = await probeXmlrpc(baseUrl, { probe });
  const sensitivePaths = await probeSensitivePaths(baseUrl, { probe });
  return { homepage, xmlrpc, sensitivePaths };
}
