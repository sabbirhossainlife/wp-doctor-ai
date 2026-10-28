// Tool 11 passive HTTP probes (Milestone 15). All requests go through the
// M2 pinned components — parseScanTarget (URL policy), resolveAndValidate
// (DNS + fail-closed IP policy), pinnedRequest (pinned transport,
// rejectUnauthorized never disabled). No second network stack, no
// unrestricted fetch, no credentials, no POST, no payloads, no auth.
// Every request is a plain unauthenticated GET of a public URL path.
// Redirects on the homepage probe are followed ONLY to the same hostname,
// max 5 hops (M2 limit); a cross-host redirect stops that check with a
// recorded redirect note (the destination is never fetched). HTTPS→HTTP
// downgrades are blocked, never followed. robots.txt and sitemaps are
// fetched from the REQUESTED origin only, never from a redirect target.
// Per-diagnostic request cap: 15 (homepage ≤ 6 + robots.txt 1 + sitemap
// index 1 + ≤ 5 child sitemaps). The `probe` dependency (injected in
// tests) must return the same shape as probeUrl: { status, headers,
// bodyPreview?, bodyTruncated?, error? }. The `testPin` seam is TEST-ONLY
// (in-process): fn(target) => { address, family } | null. When it returns
// an address, the DNS/IP-policy stage is skipped for that hop so local
// loopback fixtures can be reached; the pinned transport, redirect
// handling, and prefix-stop behaviour remain fully real. The service and
// all routes NEVER pass testPin; only tests do, in-process.
import { parseScanTarget } from "../scanner/url-policy.js";
import { resolveAndValidate } from "../scanner/dns.js";
import { pinnedRequest } from "../scanner/transport.js";
import { redactUrlForLog } from "../scanner/errors.js";

export const SEO_HTTP_LIMITS = Object.freeze({
  maxRequestsPerScan: 15,
  maxRedirects: 5,
  homepageHeadBytes: 64 * 1024,
  homepageMaxBytes: 256 * 1024,
  robotsMaxBytes: 64 * 1024,
  sitemapMaxBytes: 256 * 1024,
  sitemapChildMax: 5,
  probeTimeoutMs: 10000,
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function safeHeader(headers, name) {
  if (!headers || typeof headers !== "object") return null;
  const value = headers[name] ?? headers[name.toLowerCase()] ?? null;
  return typeof value === "string" ? value : null;
}

// Real pinned probe. `mode` selects the body policy: "head" (stop after
// the first 64 KiB prefix — Tool 11 homepage only), "full" (bounded full
// body for robots.txt / sitemaps), "headers" (no body capture).
export async function probeUrl(url, { mode = "headers", testPin = null } = {}) {
  const target = parseScanTarget(url);
  let chosen;
  if (typeof testPin === "function") {
    const pinned = testPin(target);
    if (pinned && pinned.address) chosen = { address: pinned.address, family: pinned.family ?? 4 };
  }
  if (!chosen) {
    const resolved = await resolveAndValidate(target, {});
    chosen = resolved.chosen;
  }
  const isHead = mode === "head";
  const isFull = mode === "full";
  const maxBytes =
    mode === "head" ? SEO_HTTP_LIMITS.homepageMaxBytes
    : mode === "full" ? (url.includes("/robots.txt") ? SEO_HTTP_LIMITS.robotsMaxBytes : SEO_HTTP_LIMITS.sitemapMaxBytes)
    : SEO_HTTP_LIMITS.homepageMaxBytes;
  const res = await pinnedRequest({
    protocol: target.protocol,
    hostname: target.hostname,
    ip: chosen.address,
    family: chosen.family,
    port: target.port,
    path: target.path,
    timeoutMs: SEO_HTTP_LIMITS.probeTimeoutMs,
    maxBytes,
    ...(isHead || isFull
      ? {
          captureBodyBytes: isHead ? SEO_HTTP_LIMITS.homepageHeadBytes : maxBytes,
          ...(isHead ? { stopAfterCaptureBytes: SEO_HTTP_LIMITS.homepageHeadBytes } : {}),
        }
      : {}),
  });
  return {
    status: res.status,
    headers: res.headers ?? {},
    bodyPreview: res.bodyPreview ?? null,
    bodyTruncated: res.bodyTruncated ?? false,
  };
}

function joinOrigin(baseUrl, path) {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.host}${path}`;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

// Homepage probe with same-host redirect following + head capture on the
// terminal hop. Returns { chain, finalUrl, finalStatus, headers,
// headPreview, headTruncated, redirectCount, crossHostRedirect,
// crossHostDestinationHost, terminalError, error }.
// `count` is a shared per-diagnostic request counter ({ n }) — when the
// cap is hit the probe stops with error REQUEST_CAP_REACHED.
export async function probeHomepage(baseUrl, { probe = probeUrl, count = null } = {}) {
  const chain = [];
  let current = baseUrl;
  let redirectCount = 0;
  let terminalError = null;
  let crossHostRedirect = false;
  let crossHostDestinationHost = null;
  try {
    for (let hop = 0; hop <= SEO_HTTP_LIMITS.maxRedirects; hop++) {
      if (count) {
        count.n += 1;
        if (count.n > SEO_HTTP_LIMITS.maxRequestsPerScan) {
          terminalError = "REQUEST_CAP_REACHED";
          break;
        }
      }
      let res;
      try {
        res = await probe(current, { mode: "head" });
      } catch (err) {
        terminalError = String(err?.code ?? err?.message ?? "PROBE_FAILED").slice(0, 100);
        break;
      }
      if (res.error) { terminalError = String(res.error).slice(0, 100); break; }
      const status = res.status;
      const location = safeHeader(res.headers, "location");
      const hopRecord = {
        url: redactUrlForLog(current),
        status,
        xRobotsTag: safeHeader(res.headers, "x-robots-tag"),
        contentType: safeHeader(res.headers, "content-type"),
      };
      chain.push(hopRecord);
      if (REDIRECT_STATUSES.has(status) && location) {
        let next;
        try { next = new URL(location, current).toString(); } catch {
          terminalError = "INVALID_REDIRECT";
          break;
        }
        if (hostOf(next) !== hostOf(current)) {
          crossHostRedirect = true;
          crossHostDestinationHost = hostOf(next);
          hopRecord.redirectToHost = crossHostDestinationHost;
          break;
        }
        // Downgrade check: https hop redirecting to http is blocked.
        if (new URL(current).protocol === "https:" && new URL(next).protocol === "http:") {
          terminalError = "DOWNGRADE_BLOCKED";
          break;
        }
        if (hop === SEO_HTTP_LIMITS.maxRedirects) { terminalError = "TOO_MANY_REDIRECTS"; break; }
        current = next;
        redirectCount += 1;
        continue;
      }
      return {
        chain,
        finalUrl: redactUrlForLog(current),
        finalStatus: status,
        headers: res.headers ?? {},
        headPreview: typeof res.bodyPreview === "string" ? res.bodyPreview : null,
        headTruncated: res.bodyTruncated === true,
        redirectCount,
        crossHostRedirect: false,
        crossHostDestinationHost: null,
        terminalError: null,
        error: null,
      };
    }
  } catch (err) {
    terminalError = String(err?.code ?? err?.message ?? "PROBE_FAILED").slice(0, 100);
  }
  const last = chain[chain.length - 1] || null;
  return {
    chain,
    finalUrl: last ? last.url : redactUrlForLog(baseUrl),
    finalStatus: last ? last.status : null,
    headers: {},
    headPreview: null,
    headTruncated: false,
    redirectCount,
    crossHostRedirect,
    crossHostDestinationHost,
    terminalError,
    error: terminalError,
  };
}

// robots.txt from the REQUESTED origin. Returns { status, body, error }.
// 404 is a normal outcome (missing), not an error.
export async function probeRobots(baseUrl, { probe = probeUrl, count = null } = {}) {
  if (count) {
    count.n += 1;
    if (count.n > SEO_HTTP_LIMITS.maxRequestsPerScan) return { status: null, body: null, error: "REQUEST_CAP_REACHED" };
  }
  try {
    const res = await probe(joinOrigin(baseUrl, "/robots.txt"), { mode: "full" });
    if (res.error) return { status: null, body: null, error: String(res.error).slice(0, 100) };
    return { status: res.status, body: typeof res.bodyPreview === "string" ? res.bodyPreview : null, error: null };
  } catch (err) {
    return { status: null, body: null, error: String(err?.code ?? err?.message ?? "PROBE_FAILED").slice(0, 100) };
  }
}

// One sitemap fetch (index or child). Same-host URLs only — the caller
// guarantees this; a cross-host URL is never passed here.
export async function probeSitemap(sitemapUrl, { probe = probeUrl, count = null } = {}) {
  if (count) {
    count.n += 1;
    if (count.n > SEO_HTTP_LIMITS.maxRequestsPerScan) return { status: null, body: null, error: "REQUEST_CAP_REACHED" };
  }
  try {
    const res = await probe(sitemapUrl, { mode: "full" });
    if (res.error) return { status: null, body: null, error: String(res.error).slice(0, 100) };
    return { status: res.status, body: typeof res.bodyPreview === "string" ? res.bodyPreview : null, error: null, bodyTruncated: res.bodyTruncated === true };
  } catch (err) {
    return { status: null, body: null, error: String(err?.code ?? err?.message ?? "PROBE_FAILED").slice(0, 100) };
  }
}
