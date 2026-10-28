// Tool 06 SSL + redirect diagnostic engine (diagnostic only).
// Built on the M2 scanner: every hop is parsed by parseScanTarget,
// resolved by resolveAndValidate (ALL answers validated), and fetched
// by pinnedRequest against the single validated IP. Every redirect
// destination is fully revalidated before connecting — there is no
// second independent DNS lookup that could choose a different address
// (DNS-rebinding protection), and no auto-follow: redirects are handled
// manually, one hop at a time. HTTPS→HTTP downgrades are recorded and
// blocked, never followed. No cookies, Authorization headers, or
// credentials are ever sent; no response body is stored; query strings
// and fragments are stripped from every stored URL via redactUrlForLog.
// Certificate metadata is recorded ONLY when the TLS handshake verified
// (see tls-probe.js); on failure only the error code is evidence.
import { parseScanTarget, resolveAndValidate, pinnedRequest, ScannerError, redactUrlForLog, SCANNER_LIMITS } from "../scanner/index.js";
import { classifyTlsError, verifiedCertFromTlsInfo, daysToExpiry } from "./tls-probe.js";
import { runSslRules, EXPIRY_WARNING_DAYS } from "./rules.js";

export const SSL_LIMITS = Object.freeze({
  dnsTimeoutMs: SCANNER_LIMITS.dnsTimeoutMs,
  overallTimeoutMs: SCANNER_LIMITS.overallTimeoutMs,
  tlsTimeoutMs: SCANNER_LIMITS.overallTimeoutMs,
  maxRedirects: SCANNER_LIMITS.maxRedirects,
  maxBodyBytes: SCANNER_LIMITS.maxBodyBytes,
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const POLICY_CODES = new Set(["INVALID_URL", "UNSUPPORTED_SCHEME", "UNSUPPORTED_PORT", "PROHIBITED_DESTINATION"]);

function bestEffortRedact(input) {
  try {
    return redactUrlForLog(new URL(input).toString());
  } catch {
    return "[invalid-url]";
  }
}

function initialSchemeOf(input) {
  try {
    return new URL(input).protocol.replace(":", "") || null;
  } catch {
    return null;
  }
}

// deps (all injectable for tests):
//   resolver — passed to resolveAndValidate
//   transport — fn like pinnedRequest (default: pinnedRequest)
//   tlsCa — test-only CA injection, passed through to the transport
//   testPin — TEST-ONLY in-process seam: fn(target) => { address, family }
//     | null. When it returns an address, the DNS/IP-policy stage is
//     skipped for that hop so local loopback fixtures can be reached.
//     The TLS handshake, hostname verification, HTTP exchange, and
//     redirect handling remain fully real. The service and all routes
//     NEVER pass testPin; only tests do, in-process.
//   nowMs — expiry calculation clock (tests)
export async function runSslRedirectCheck(input, deps = {}) {
  const limits = { ...SSL_LIMITS, ...(deps.limits || {}) };
  const resolver = deps.resolver;
  const transport = deps.transport || pinnedRequest;
  const nowMs = deps.nowMs ?? Date.now();
  const started = Date.now();
  const chain = [];
  const visited = new Set();
  let tlsOutcome = null;
  let terminalReason = null;
  let terminalErrorCode = null;
  let currentInput = input;
  let currentBase = null;
  let previousProtocol = null;
  let successfulHops = 0;
  const initialScheme = initialSchemeOf(typeof input === "string" ? input.trim() : "");
  const sanitizedTargetUrl = bestEffortRedact(typeof input === "string" ? input.trim() : "");

  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    let target;
    try {
      target = parseScanTarget(currentInput, currentBase);
    } catch (error) {
      const code = error instanceof ScannerError ? error.code : "INTERNAL_SCANNER_ERROR";
      if (hop === 0) {
        terminalReason = "POLICY_REJECTED";
        terminalErrorCode = code;
        chain.push({
          step: 0, url: sanitizedTargetUrl, status: null, destination: null,
          hostChanged: false, scheme: initialScheme, tlsResult: null,
          outcome: "rejected", errorCode: code,
        });
      } else {
        const prev = chain[chain.length - 1];
        if (prev) prev.outcome = "rejected";
        terminalReason = "DESTINATION_REJECTED";
        terminalErrorCode = code;
      }
      break;
    }
    // Downgrade: a redirect from an https hop to http is recorded on the
    // redirecting hop and NOT followed.
    if (previousProtocol === "https:" && target.protocol === "http:") {
      const prev = chain[chain.length - 1];
      if (prev) {
        prev.destination = redactUrlForLog(target.url);
        prev.hostChanged = prev.url ? new URL(prev.url).hostname !== target.hostname : false;
        prev.outcome = "blocked";
      }
      terminalReason = "DOWNGRADE_BLOCKED";
      terminalErrorCode = "DOWNGRADE_DETECTED_BLOCKED";
      break;
    }
    if (visited.has(target.url)) {
      chain.push({
        step: chain.length, url: redactUrlForLog(target.url), status: null,
        destination: null, hostChanged: false, scheme: target.protocol.replace(":", ""),
        tlsResult: null, outcome: "blocked", errorCode: "REDIRECT_LOOP",
      });
      terminalReason = "LOOP";
      terminalErrorCode = "REDIRECT_LOOP";
      break;
    }
    visited.add(target.url);

    // Resolve + pin (per hop, revalidated every time).
    let chosen;
    try {
      if (typeof deps.testPin === "function") {
        const pinned = deps.testPin(target);
        if (pinned && pinned.address) {
          chosen = { address: pinned.address, family: pinned.family ?? 4 };
        }
      }
      if (!chosen) {
        const resolved = await resolveAndValidate(target, {
          resolver,
          dnsTimeoutMs: limits.dnsTimeoutMs,
        });
        chosen = resolved.chosen;
      }
    } catch (error) {
      const code = error instanceof ScannerError ? error.code : "INTERNAL_SCANNER_ERROR";
      if (hop === 0 && POLICY_CODES.has(code)) {
        chain.push({
          step: 0, url: redactUrlForLog(target.url), status: null, destination: null,
          hostChanged: false, scheme: target.protocol.replace(":", ""), tlsResult: null,
          outcome: "rejected", errorCode: code,
        });
        terminalReason = "POLICY_REJECTED";
        terminalErrorCode = code;
      } else if (hop > 0 && POLICY_CODES.has(code)) {
        const prev = chain[chain.length - 1];
        if (prev) prev.outcome = "rejected";
        terminalReason = "DESTINATION_REJECTED";
        terminalErrorCode = code;
      } else {
        chain.push({
          step: chain.length, url: redactUrlForLog(target.url), status: null,
          destination: null, hostChanged: false, scheme: target.protocol.replace(":", ""),
          tlsResult: null, outcome: "blocked", errorCode: code,
        });
        terminalReason = code === "DNS_FAILURE" ? "DNS_FAILURE" : "NETWORK_OR_TIMEOUT";
        terminalErrorCode = code;
      }
      break;
    }

    // Fetch the hop (pinned transport; TLS info captured for https).
    let response;
    try {
      response = await transport({
        protocol: target.protocol,
        hostname: target.hostname,
        ip: chosen.address,
        family: chosen.family,
        port: target.port,
        path: target.path,
        timeoutMs: limits.overallTimeoutMs,
        maxBytes: limits.maxBodyBytes,
        ...(target.protocol === "https:" ? { captureTls: true } : {}),
        ...(deps.tlsCa !== undefined ? { ca: deps.tlsCa } : {}),
      });
    } catch (error) {
      const code = error instanceof ScannerError ? error.code : "INTERNAL_SCANNER_ERROR";
      const detail = error instanceof ScannerError ? error.detail : null;
      let tlsResult = null;
      if (target.protocol === "https:") {
        if (code === "TLS_FAILURE") {
          const errorCode = classifyTlsError({ code: typeof detail === "string" ? detail : "", message: "" });
          tlsResult = { verified: false, errorCode, protocol: null, cipher: null };
          tlsOutcome = { scheme: "https", verified: false, errorCode, certificate: null, daysToExpiry: null };
          terminalReason = "TLS_FAILURE";
        } else if (code === "REQUEST_TIMEOUT") {
          tlsResult = { verified: false, errorCode: "TLS_TIMEOUT", protocol: null, cipher: null };
          tlsOutcome = { scheme: "https", verified: false, errorCode: "TLS_TIMEOUT", certificate: null, daysToExpiry: null };
          terminalReason = "NETWORK_OR_TIMEOUT";
        } else {
          terminalReason = code === "DNS_FAILURE" ? "DNS_FAILURE" : "NETWORK_OR_TIMEOUT";
        }
      } else {
        terminalReason = code === "DNS_FAILURE" ? "DNS_FAILURE" : code === "RESPONSE_LIMIT_EXCEEDED" ? "RESPONSE_LIMIT" : "NETWORK_OR_TIMEOUT";
      }
      terminalErrorCode = code;
      chain.push({
        step: chain.length, url: redactUrlForLog(target.url), status: null,
        destination: null, hostChanged: false, scheme: target.protocol.replace(":", ""),
        tlsResult, outcome: "blocked", errorCode: code,
      });
      break;
    }

    successfulHops += 1;
    let tlsResult = null;
    if (target.protocol === "https:") {
      const certificate = verifiedCertFromTlsInfo(response.tlsInfo ?? null, target.hostname);
      if (certificate) {
        const days = daysToExpiry(certificate.validTo, nowMs);
        tlsResult = { verified: true, errorCode: null, protocol: certificate.protocol, cipher: certificate.cipher, validTo: certificate.validTo, daysToExpiry: days };
        tlsOutcome = { scheme: "https", verified: true, errorCode: null, certificate, daysToExpiry: days };
      } else if (response.tlsInfo) {
        // Handshake completed but the socket did not authorize and yet a
        // response arrived: do not trust any certificate fields.
        tlsResult = { verified: false, errorCode: "TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT", protocol: null, cipher: null };
        tlsOutcome = { scheme: "https", verified: false, errorCode: "TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT", certificate: null, daysToExpiry: null };
      }
    }
    const hopRecord = {
      step: chain.length,
      url: redactUrlForLog(target.url),
      status: response.status,
      destination: null,
      hostChanged: false,
      scheme: target.protocol.replace(":", ""),
      tlsResult,
      outcome: "terminal",
    };
    chain.push(hopRecord);

    const location = response.headers?.location ?? null;
    if (REDIRECT_STATUSES.has(response.status) && location) {
      let destTarget = null;
      try {
        destTarget = parseScanTarget(location, target.url);
      } catch {
        destTarget = null;
      }
      if (!destTarget) {
        hopRecord.outcome = "rejected";
        terminalReason = "DESTINATION_REJECTED";
        terminalErrorCode = "INVALID_URL";
        break;
      }
      hopRecord.destination = redactUrlForLog(destTarget.url);
      hopRecord.hostChanged = destTarget.hostname !== target.hostname;
      if (hop === limits.maxRedirects) {
        hopRecord.outcome = "blocked";
        terminalReason = "MAX_REDIRECTS";
        terminalErrorCode = "MAX_REDIRECTS_REACHED";
        break;
      }
      hopRecord.outcome = "followed";
      currentInput = location;
      currentBase = target.url;
      previousProtocol = target.protocol;
      continue;
    }
    terminalReason = "TERMINAL_RESPONSE";
    break;
  }

  if (!terminalReason) {
    terminalReason = "MAX_REDIRECTS";
    terminalErrorCode = "MAX_REDIRECTS_REACHED";
  }

  let executionStatus;
  if (terminalReason === "POLICY_REJECTED") executionStatus = "BLOCKED";
  else if (terminalReason === "TERMINAL_RESPONSE" || terminalReason === "DOWNGRADE_BLOCKED") executionStatus = "COMPLETED";
  else if (terminalReason === "TLS_FAILURE") executionStatus = successfulHops > 0 ? "PARTIAL" : "COMPLETED";
  else if (successfulHops > 0) executionStatus = "PARTIAL";
  else executionStatus = "FAILED";

  const finalHop = chain[chain.length - 1] || null;
  const finalScheme = finalHop?.scheme ?? initialScheme;
  const certStatus = !tlsOutcome
    ? (chain.some((h) => h.scheme === "https") ? "UNKNOWN" : "NOT_APPLICABLE")
    : tlsOutcome.verified
      ? (typeof tlsOutcome.daysToExpiry === "number" && tlsOutcome.daysToExpiry <= EXPIRY_WARNING_DAYS ? "EXPIRING_SOON" : "VALID")
      : tlsOutcome.errorCode;
  const summary = {
    certStatus,
    finalUrl: finalHop?.url ?? null,
    finalStatus: finalHop?.status ?? null,
    redirectCount: chain.length > 0 ? chain.length - 1 : 0,
    crossHost: chain.some((h) => h.hostChanged === true),
    downgradeBlocked: terminalReason === "DOWNGRADE_BLOCKED",
    terminalReason,
    errorCode: terminalErrorCode,
  };
  const limitations = [
    "Certificate details are recorded only when the TLS handshake verifies; unverified certificates contribute only an error code.",
    "Redirect chain limited to 5 hops; the check follows redirects manually and never sends cookies or credentials.",
    "Query strings and fragments are stripped from all stored URLs.",
  ];
  if (terminalReason === "TLS_FAILURE") {
    limitations.push("No HTTP response was obtained for the hop whose TLS handshake failed; no status code is claimed for that hop.");
  }
  const findings = runSslRules({
    executionStatus,
    chain,
    tlsOutcome,
    terminalReason,
    initialScheme,
    finalScheme,
  });
  return {
    sanitizedTargetUrl,
    executionStatus,
    terminalReason,
    errorCode: terminalErrorCode,
    chain: chain.slice(0, 12),
    tlsOutcome,
    summary,
    limitations,
    durationMs: Date.now() - started,
    findings,
  };
}
