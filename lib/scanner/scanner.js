// Safe scan engine (internal library only — no HTTP route exposes it in
// Milestone 2). Flow per hop: parse + normalize -> resolve ALL answers ->
// reject on ANY prohibited answer -> pin transport to the single chosen
// address -> manual redirect handling with full re-validation per hop.
// HTTPS -> HTTP downgrades are REJECTED (PROHIBITED_DESTINATION).
// No retries: a failed hop fails the scan (no fallback to another address,
// which would defeat pinning). No response body is retained — only status,
// a few safe headers, and byte counts.
import { parseScanTarget } from "./url-policy.js";
import { resolveAndValidate } from "./dns.js";
import { pinnedRequest } from "./transport.js";
import { ScannerError, redactUrlForLog } from "./errors.js";
import { logScanEvent } from "./logging.js";

export const SCANNER_LIMITS = Object.freeze({
  dnsTimeoutMs: 5000,
  overallTimeoutMs: 10000,
  maxRedirects: 5,
  maxBodyBytes: 256 * 1024,
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function safeHeaders(headers) {
  return {
    contentType: headers["content-type"] ?? null,
    contentLength: headers["content-length"]
      ? Number(headers["content-length"])
      : null,
    location: headers.location ?? null,
  };
}

// deps (all injectable for tests):
//   resolver, transport (fn like pinnedRequest), limiter ({check, run} | null),
//   logger (fn), limits (partial override of SCANNER_LIMITS)
export async function scanUrl(input, deps = {}) {
  const limits = { ...SCANNER_LIMITS, ...(deps.limits || {}) };
  const limiter = deps.limiter || null;
  const logger = deps.logger || logScanEvent;
  const transport = deps.transport || pinnedRequest;
  const started = Date.now();
  const chain = [];
  const visited = new Set();
  try {
    if (limiter) {
      limiter.check({ userId: deps.userId, ip: deps.ip });
    }
    const runScan = async () => {
      let currentInput = input;
      let currentBase = null;
      for (let hop = 0; hop <= limits.maxRedirects; hop++) {
        const target = parseScanTarget(currentInput, currentBase);
        if (hop > 0 && chain[0].protocol === "https:" && target.protocol === "http:") {
          throw new ScannerError(
            "PROHIBITED_DESTINATION",
            "https to http downgrade",
          );
        }
        // Loop detection on the full normalized URL (query included, but
        // the query itself is never logged or stored — see logging.js).
        if (visited.has(target.url)) {
          throw new ScannerError("TOO_MANY_REDIRECTS", "redirect loop");
        }
        visited.add(target.url);
        const { chosen } = await resolveAndValidate(target, {
          resolver: deps.resolver,
          dnsTimeoutMs: limits.dnsTimeoutMs,
        });
        const response = await transport({
          protocol: target.protocol,
          hostname: target.hostname,
          ip: chosen.address,
          family: chosen.family,
          port: target.port,
          path: target.path,
          timeoutMs: limits.overallTimeoutMs,
          maxBytes: limits.maxBodyBytes,
        });
        chain.push({
          url: redactUrlForLog(target.url),
          protocol: target.protocol,
          status: response.status,
          contentType: safeHeaders(response.headers).contentType,
          bodyBytes: response.bodyBytes,
        });
        if (
          REDIRECT_STATUSES.has(response.status) &&
          safeHeaders(response.headers).location
        ) {
          if (hop === limits.maxRedirects) {
            throw new ScannerError("TOO_MANY_REDIRECTS", "redirect limit");
          }
          currentInput = safeHeaders(response.headers).location;
          currentBase = target.url;
          continue;
        }
        return {
          ok: true,
          finalUrl: redactUrlForLog(target.url),
          finalStatus: response.status,
          redirectCount: chain.length - 1,
          chain,
          durationMs: Date.now() - started,
        };
      }
      throw new ScannerError("TOO_MANY_REDIRECTS", "redirect limit");
    };
    const result = limiter ? await limiter.run(runScan) : await runScan();
    logger({
      outcome: "completed",
      status: result.finalStatus,
      url: result.finalUrl,
      host: chain[0] ? new URL(chain[0].url).hostname : null,
      redirects: result.redirectCount,
      durationMs: result.durationMs,
    });
    return result;
  } catch (error) {
    const scannerError =
      error instanceof ScannerError
        ? error
        : new ScannerError("INTERNAL_SCANNER_ERROR", String(error));
    logger({
      outcome: "failed",
      code: scannerError.code,
      url: null,
      host: null,
      redirects: chain.length > 0 ? chain.length - 1 : 0,
      durationMs: Date.now() - started,
    });
    throw scannerError;
  }
}
