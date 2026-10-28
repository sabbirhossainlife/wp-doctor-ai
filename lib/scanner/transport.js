// Pinned HTTP/HTTPS transport. The socket is created against the validated
// IP only — the original hostname is NEVER re-resolved:
//   - http:  net.connect({ host: pinnedIp, port })
//   - https: tls.connect({ host: pinnedIp, port, servername: hostname })
//     so SNI carries the hostname and the certificate is verified against
//     the hostname (never against the IP). rejectUnauthorized is never
//     disabled; there is no lookup hook to bypass, no keep-alive pooling
//     across destinations (one agent per request, destroyed afterwards),
//     and no fallback to any other address on failure.
// The transport itself does not classify addresses — the caller (scanner)
// must pass an address already validated by dns.js. Tests inject a fake
// transport; the real transport is proven separately against a local
// server in tests/scanner-transport.test.js.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { ScannerError } from "./errors.js";

export const SCANNER_USER_AGENT = "WP-Doctor-AI-Scanner/1.0 (diagnostic)";

// The pin MUST be a subclass override: Node's http/https Agent ignores a
// `createConnection` function passed as a constructor option (verified on
// Node 24 — the option is silently dropped and the default connection to
// the hostname is used instead). Subclassing is the documented override
// point, and the tests prove it by connecting to an unresolvable hostname.
//
// Milestone 10 extension (backwards compatible, default off): the agent
// accepts an optional `ca` (passed through to tls.connect ONLY when an
// in-process caller explicitly supplies it — the Tool 06 test fixtures do
// this so a test CA can sign local fixture certificates; production routes
// never supply it, so production always uses the default trusted CA
// store) and an optional `captureTls` flag. When capturing, the live
// socket's verified certificate data is recorded on `secureConnect` and
// returned as `tlsInfo` on the request result. rejectUnauthorized is
// NEVER disabled in any code path.
function makePinnedAgent(isHttps, ip, hostname, { ca, captureTls } = {}) {
  const Base = isHttps ? https.Agent : http.Agent;
  class PinnedAgent extends Base {
    createConnection(options, callback) {
      let socket;
      if (isHttps) {
        socket = tls.connect({
          host: ip,
          port: options.port,
          servername: hostname,
          ...(ca !== undefined ? { ca } : {}),
          // rejectUnauthorized intentionally left at its default (true).
        });
        if (captureTls) {
          socket.once("secureConnect", () => {
            let peerCertificate = null;
            try {
              peerCertificate = socket.getPeerCertificate(true) || null;
            } catch {
              peerCertificate = null;
            }
            let cipher = null;
            try {
              cipher = socket.getCipher()?.name ?? null;
            } catch {
              cipher = null;
            }
            let protocol = null;
            try {
              protocol = socket.getProtocol() ?? null;
            } catch {
              protocol = null;
            }
            socket.__wpDoctorTlsInfo = {
              verified: socket.authorized === true,
              authorizationError: socket.authorizationError
                ? String(socket.authorizationError)
                : null,
              protocol,
              cipher,
              peerCertificate,
            };
          });
        }
      } else {
        socket = net.connect({ host: ip, port: options.port });
      }
      if (callback) {
        let called = false;
        const done = (error) => {
          if (called) return;
          called = true;
          callback(error || null, error ? undefined : socket);
        };
        socket.once(isHttps ? "secureConnect" : "connect", () => done(null));
        socket.once("error", done);
      }
      return socket;
    }
  }
  return new PinnedAgent({ keepAlive: false });
}

function classifyTransportError(error, phase) {
  const code = error?.code || "";
  const message = String(error?.message || "");
  if (
    code === "REQUEST_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    /timed out/i.test(message)
  ) {
    return new ScannerError("REQUEST_TIMEOUT", phase);
  }
  if (
    code.startsWith("CERT_") ||
    code.startsWith("ERR_TLS_") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    /certificate/i.test(message) ||
    /self signed/i.test(message)
  ) {
    return new ScannerError("TLS_FAILURE", code || phase);
  }
  if (code === "HPE_HEADER_OVERFLOW" || code === "ERR_HTTP2_TOO_LARGE") {
    return new ScannerError("RESPONSE_LIMIT_EXCEEDED", code);
  }
  return new ScannerError("CONNECTION_FAILURE", code || phase);
}

// requestInput: { protocol, hostname, ip, family, port, path, timeoutMs,
//   maxBytes, headers? } — headers are fixed by the scanner; callers must
//   not pass user-controlled headers. Optional Milestone 10 fields: `ca`
//   (in-process test-CA injection only, see makePinnedAgent) and
//   `captureTls` (when true, the result gains `tlsInfo` for https hops).
//   Optional Milestone 12 field: `captureBodyBytes` (default 0/off) — when
//   set, the FIRST N body bytes are returned as `bodyPreview` (a string,
//   decoded lossily) for signature classification by the caller ONLY.
//   Callers must classify and discard it immediately and never persist it.
//   Only Tool 08's sensitive-path probes use this; every other caller keeps
//   the M2 behaviour of retaining no body content. The overall maxBytes
//   limit still applies and still aborts oversized bodies.
//   Optional Milestone 15 field: `stopAfterCaptureBytes` (default 0/off)
//   — when set alongside captureBodyBytes, the transport stops consuming
//   as soon as the captured prefix reaches the cap and resolves
//   successfully with `bodyTruncated: true`, instead of reading the whole
//   body. This exists so Tool 11 can read a homepage `<head>` (which sits
//   at the start of the body) without failing on homepages larger than
//   maxBytes. Only Tool 11 passes it; every other caller keeps exact M2
//   behaviour (full-body byte counting, abort over maxBytes).
//   Returns { status, headers, bodyBytes, bodyTruncated, durationMs,
//   tlsInfo?, bodyPreview? }.
export function pinnedRequest(requestInput) {
  const {
    protocol,
    hostname,
    ip,
    port,
    path,
    timeoutMs,
    maxBytes,
    ca,
    captureTls,
    captureBodyBytes,
    stopAfterCaptureBytes,
  } = requestInput;
  const captureCap = Number.isInteger(captureBodyBytes) && captureBodyBytes > 0 ? captureBodyBytes : 0;
  const stopCap = Number.isInteger(stopAfterCaptureBytes) && stopAfterCaptureBytes > 0 ? stopAfterCaptureBytes : 0;
  const isHttps = protocol === "https:";
  const lib = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    let bodyBytes = 0;
    let bodyTruncated = false;
    // Per-request agent whose socket creation is pinned to `ip`. The
    // `host` option the agent receives (the hostname) is deliberately
    // ignored inside createConnection — that is the pinning mechanism.
    const agent = makePinnedAgent(isHttps, ip, hostname, { ca, captureTls: captureTls === true });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      try {
        agent.destroy();
      } catch {
        // ignore cleanup errors
      }
      if (error) reject(error);
      else resolve(result);
    };
    let req;
    try {
      req = lib.request(
        {
          host: hostname,
          port,
          path,
          method: "GET",
          agent,
          headers: {
            host: hostname,
            "user-agent": SCANNER_USER_AGENT,
            accept: "*/*",
            connection: "close",
          },
        },
        (res) => {
          const headers = {};
          for (const [key, value] of Object.entries(res.headers)) {
            headers[key.toLowerCase()] = Array.isArray(value)
              ? value.join(", ")
              : value;
          }
          const previewChunks = [];
          let previewBytes = 0;
          res.on("data", (chunk) => {
            bodyBytes += chunk.length;
            if (captureCap > 0 && previewBytes < captureCap) {
              const take = chunk.subarray(0, captureCap - previewBytes);
              previewChunks.push(take);
              previewBytes += take.length;
            }
            // Milestone 15 opt-in: the wanted prefix is complete — stop
            // consuming and resolve successfully instead of reading (and
            // potentially aborting on) the rest of the body.
            if (stopCap > 0 && previewBytes >= stopCap) {
              bodyTruncated = true;
              res.destroy();
              req.destroy();
              finish(null, {
                status: res.statusCode,
                headers,
                bodyBytes,
                bodyTruncated,
                ...(captureCap > 0 ? { bodyPreview: Buffer.concat(previewChunks).toString("utf8") } : {}),
                durationMs: Date.now() - started,
                ...(captureTls === true && req.socket?.__wpDoctorTlsInfo
                  ? { tlsInfo: req.socket.__wpDoctorTlsInfo }
                  : {}),
              });
              return;
            }
            if (bodyBytes > maxBytes) {
              bodyTruncated = true;
              // Stop consuming immediately; destroy stream + socket.
              res.destroy();
              req.destroy();
              finish(
                new ScannerError(
                  "RESPONSE_LIMIT_EXCEEDED",
                  `body over ${maxBytes} bytes`,
                ),
              );
            }
          });
          res.on("end", () => {
            finish(null, {
              status: res.statusCode,
              headers,
              bodyBytes,
              bodyTruncated,
              ...(captureCap > 0 ? { bodyPreview: Buffer.concat(previewChunks).toString("utf8") } : {}),
              durationMs: Date.now() - started,
              ...(captureTls === true && req.socket?.__wpDoctorTlsInfo
                ? { tlsInfo: req.socket.__wpDoctorTlsInfo }
                : {}),
            });
          });
          res.on("error", (error) => {
            finish(classifyTransportError(error, "response"));
          });
        },
      );
    } catch (error) {
      finish(classifyTransportError(error, "request"));
      return;
    }
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("request timed out"));
      finish(new ScannerError("REQUEST_TIMEOUT", "overall timeout"));
    });
    req.on("timeout", () => {
      req.destroy(new Error("request timed out"));
      finish(new ScannerError("REQUEST_TIMEOUT", "overall timeout"));
    });
    req.on("error", (error) => {
      finish(classifyTransportError(error, "request"));
    });
    req.end();
  });
}
