// Tool 12 pinned HTTP probe (Milestone 16). All requests go through the
// M2 pinned components — parseScanTarget (URL policy), resolveAndValidate
// (DNS + fail-closed IP policy), pinnedRequest (pinned transport,
// rejectUnauthorized never disabled). No second network stack, no
// unrestricted fetch, no credentials, no POST, no auth headers.
//
// Redirect policy (stricter than the M2 scanUrl helper, which follows
// cross-host redirects): redirects are followed ONLY to the same
// hostname, max 5 hops; a cross-host redirect stops the probe with
// crossHostRedirectBlocked (the destination is never fetched); an
// https→http downgrade is blocked, never followed. The first 8 KiB of
// the terminal response is captured (stopAfterCaptureBytes) SOLELY to
// classify a WordPress maintenance signature; the caller classifies and
// discards it immediately — it is never persisted. Latency uses
// performance.now() (monotonic) plus wall-clock timestamps from the
// caller. The `testPin` seam is TEST-ONLY (in-process): when it returns
// an address, the DNS/IP-policy stage is skipped for that hop so local
// loopback fixtures can be reached; the pinned transport, redirect
// handling, and prefix-stop behaviour remain fully real. The service
// and all routes NEVER pass testPin; only tests do, in-process.
// `transport` is likewise TEST-ONLY (same pattern as the Tool 06 engine):
// tests inject a canned transport to prove redirect/loop/downgrade logic
// without a socket, since the scanner permits only ports 80/443 and this
// VM cannot bind a privileged fixture port.
import { performance } from "node:perf_hooks";
import { parseScanTarget } from "../scanner/url-policy.js";
import { resolveAndValidate } from "../scanner/dns.js";
import { pinnedRequest } from "../scanner/transport.js";
import { ScannerError, redactUrlForLog } from "../scanner/errors.js";

export const UPTIME_HTTP_LIMITS = Object.freeze({
  maxRedirects: 5,
  probeTimeoutMs: 10000,
  maxBytes: 256 * 1024,
  headPrefixBytes: 8 * 1024,
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export async function probeTarget(url, { testPin = null, transport = null } = {}) {
  const request = transport ?? pinnedRequest;
  const startedMono = performance.now();
  let current = url;
  let currentBase = null;
  let redirectCount = 0;
  const visited = new Set();
  try {
    for (let hop = 0; hop <= UPTIME_HTTP_LIMITS.maxRedirects; hop++) {
      const target = parseScanTarget(current, currentBase);
      if (visited.has(target.url)) {
        throw new ScannerError("TOO_MANY_REDIRECTS", "redirect loop");
      }
      visited.add(target.url);
      let chosen;
      if (typeof testPin === "function") {
        const pinned = testPin(target);
        if (pinned && pinned.address) chosen = { address: pinned.address, family: pinned.family ?? 4 };
      }
      if (!chosen) {
        const resolved = await resolveAndValidate(target, {});
        chosen = resolved.chosen;
      }
      const res = await request({
        protocol: target.protocol,
        hostname: target.hostname,
        ip: chosen.address,
        family: chosen.family,
        port: target.port,
        path: target.path,
        timeoutMs: UPTIME_HTTP_LIMITS.probeTimeoutMs,
        maxBytes: UPTIME_HTTP_LIMITS.maxBytes,
        captureBodyBytes: UPTIME_HTTP_LIMITS.headPrefixBytes,
        stopAfterCaptureBytes: UPTIME_HTTP_LIMITS.headPrefixBytes,
      });
      const location = typeof res.headers?.location === "string" ? res.headers.location : null;
      if (REDIRECT_STATUSES.has(res.status) && location) {
        if (hop === UPTIME_HTTP_LIMITS.maxRedirects) {
          throw new ScannerError("TOO_MANY_REDIRECTS", "redirect limit");
        }
        let next;
        try {
          next = new URL(location, target.url).toString();
        } catch {
          throw new ScannerError("INVALID_URL", "invalid redirect location");
        }
        if (hostOf(next) !== hostOf(target.url)) {
          return {
            status: res.status,
            finalUrl: redactUrlForLog(target.url),
            redirectCount,
            crossHostRedirectBlocked: true,
            crossHostDestinationHost: hostOf(next),
            headPrefix: null,
            errorCode: "CROSS_HOST_REDIRECT",
            durationMs: Math.round(performance.now() - startedMono),
          };
        }
        if (target.protocol === "https:" && new URL(next).protocol === "http:") {
          throw new ScannerError("PROHIBITED_DESTINATION", "https to http downgrade");
        }
        redirectCount += 1;
        current = next;
        currentBase = target.url;
        continue;
      }
      return {
        status: res.status,
        finalUrl: redactUrlForLog(target.url),
        redirectCount,
        crossHostRedirectBlocked: false,
        crossHostDestinationHost: null,
        headPrefix: typeof res.bodyPreview === "string" ? res.bodyPreview : null,
        errorCode: null,
        durationMs: Math.round(performance.now() - startedMono),
      };
    }
    throw new ScannerError("TOO_MANY_REDIRECTS", "redirect limit");
  } catch (error) {
    const code = error instanceof ScannerError ? error.code : "INTERNAL_SCANNER_ERROR";
    return {
      status: null,
      finalUrl: null,
      redirectCount,
      crossHostRedirectBlocked: false,
      crossHostDestinationHost: null,
      headPrefix: null,
      errorCode: code,
      durationMs: Math.round(performance.now() - startedMono),
    };
  }
}
