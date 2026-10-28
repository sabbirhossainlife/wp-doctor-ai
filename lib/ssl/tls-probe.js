// Genuine TLS probe (Tool 06). Connects directly to a pinned IP with
// servername = the original hostname, the default trusted CA store, and
// rejectUnauthorized ALWAYS true. There is no production path that
// disables verification: `ca` is accepted ONLY as an in-process parameter
// (Tool 06 tests pass their fixture CA here); no route, service, or env
// var in production supplies it, and no global trust setting is touched.
// Certificate metadata is returned ONLY when the handshake verified;
// on any failure the certificate fields are null and the error code is
// the evidence. Sockets are closed after use; no body is read.
import tls from "node:tls";

export const TLS_ERROR_CODES = Object.freeze([
  "TLS_CERT_VALID",
  "TLS_CERT_EXPIRING_SOON",
  "TLS_CERT_EXPIRED",
  "TLS_CERT_NOT_YET_VALID",
  "TLS_HOSTNAME_MISMATCH",
  "TLS_CERT_UNTRUSTED",
  "TLS_HANDSHAKE_FAILED",
  "TLS_TIMEOUT",
  "TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT",
]);

const UNTRUSTED_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_UNTRUSTED",
  "CERT_SIGNATURE_FAILURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_CRL",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "CERT_REJECTED",
  "CERT_REVOKED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

export function classifyTlsError(error) {
  const code = error?.code || "";
  const message = String(error?.message || "");
  if (code === "CERT_HAS_EXPIRED" || /certificate has expired/i.test(message)) {
    return "TLS_CERT_EXPIRED";
  }
  if (code === "CERT_NOT_YET_VALID" || /certificate is not yet valid/i.test(message)) {
    return "TLS_CERT_NOT_YET_VALID";
  }
  if (
    code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
    code === "CERT_ALTNAME_INVALID" ||
    code === "HOSTNAME_MISMATCH" ||
    /does not match|altname|hostname mismatch/i.test(message)
  ) {
    return "TLS_HOSTNAME_MISMATCH";
  }
  if (UNTRUSTED_CODES.has(code) || /self signed|unable to verify|untrusted/i.test(message)) {
    return "TLS_CERT_UNTRUSTED";
  }
  if (
    code === "ETIMEDOUT" ||
    code === "TLS_TIMEOUT" ||
    /timed out/i.test(message)
  ) {
    return "TLS_TIMEOUT";
  }
  return "TLS_HANDSHAKE_FAILED";
}

function issuerString(issuer) {
  if (!issuer || typeof issuer !== "object") return null;
  const parts = [];
  if (issuer.O) parts.push(`O=${issuer.O}`);
  if (issuer.CN) parts.push(`CN=${issuer.CN}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function sanList(cert) {
  if (!cert || typeof cert.subjectaltname !== "string") return [];
  return cert.subjectaltname
    .split(",")
    .map((entry) => entry.trim().replace(/^DNS:/i, ""))
    .filter(Boolean)
    .slice(0, 20);
}

function parseCertDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Extract verified certificate metadata from a live, authorized socket.
// Returns null unless the socket authorized: unverified certificates are
// never reported as metadata (their issuer/dates would be attacker
// controlled and unverified).
export function verifiedCertFromSocket(socket) {
  if (!socket || socket.authorized !== true) return null;
  let cert = null;
  try {
    cert = socket.getPeerCertificate(true) || null;
  } catch {
    return null;
  }
  if (!cert || Object.keys(cert).length === 0) return null;
  const validFrom = parseCertDate(cert.valid_from);
  const validTo = parseCertDate(cert.valid_to);
  let protocol = null;
  try {
    protocol = socket.getProtocol() ?? null;
  } catch {
    protocol = null;
  }
  let cipher = null;
  try {
    cipher = socket.getCipher()?.name ?? null;
  } catch {
    cipher = null;
  }
  return {
    hostname: null, // filled in by the caller (verified hostname)
    issuer: issuerString(cert.issuer),
    validFrom: validFrom ? validFrom.toISOString() : null,
    validTo: validTo ? validTo.toISOString() : null,
    san: sanList(cert),
    protocol,
    cipher,
  };
}

export function verifiedCertFromTlsInfo(tlsInfo, hostname) {
  if (!tlsInfo || tlsInfo.verified !== true) return null;
  const cert = tlsInfo.peerCertificate;
  if (!cert || Object.keys(cert).length === 0) return null;
  const validFrom = parseCertDate(cert.valid_from);
  const validTo = parseCertDate(cert.valid_to);
  return {
    hostname,
    issuer: issuerString(cert.issuer),
    validFrom: validFrom ? validFrom.toISOString() : null,
    validTo: validTo ? validTo.toISOString() : null,
    san: sanList(cert),
    protocol: tlsInfo.protocol ?? null,
    cipher: tlsInfo.cipher ?? null,
  };
}

export function daysToExpiry(validToIso, nowMs = Date.now()) {
  if (!validToIso) return null;
  const to = new Date(validToIso).getTime();
  if (Number.isNaN(to)) return null;
  return Math.floor((to - nowMs) / (24 * 60 * 60 * 1000));
}

// Direct probe: { host (pinned IP), port, servername, ca?, timeoutMs }.
// Returns { verified, errorCode, certificate|null, protocol, cipher }.
export function probeTls({ host, port, servername, ca, timeoutMs = 10000 }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket?.destroy();
      } catch {
        // ignore cleanup errors
      }
      resolve(result);
    };
    let socket;
    try {
      socket = tls.connect({
        host,
        port,
        servername,
        ...(ca !== undefined ? { ca } : {}),
        // rejectUnauthorized intentionally left at its default (true).
      });
    } catch (error) {
      finish({
        verified: false,
        errorCode: classifyTlsError(error),
        certificate: null,
        protocol: null,
        cipher: null,
      });
      return;
    }
    // NOTE: the timer is deliberately NOT unref'd. If the socket handle
    // ever goes away without an event (silent peer), an unref'd timer
    // would let the event loop empty and the probe promise would never
    // settle. A ref'd timer guarantees the timeout always fires.
    const timer = setTimeout(() => {
      finish({
        verified: false,
        errorCode: "TLS_TIMEOUT",
        certificate: null,
        protocol: null,
        cipher: null,
      });
    }, timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const certificate = verifiedCertFromSocket(socket);
      if (certificate) certificate.hostname = servername;
      finish({
        verified: certificate !== null,
        errorCode: certificate ? null : "TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT",
        certificate,
        protocol: certificate?.protocol ?? null,
        cipher: certificate?.cipher ?? null,
      });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      finish({
        verified: false,
        errorCode: classifyTlsError(error),
        certificate: null,
        protocol: null,
        cipher: null,
      });
    });
  });
}
