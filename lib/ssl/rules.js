// Deterministic Tool 06 finding engine (pure — no I/O).
// Input: the engine result shape { executionStatus, chain, tlsOutcome,
// terminalReason, initialScheme, finalScheme }. Output: finding rows.
// Severity rules (brief): cert validation failure or a downgrade attempt
// = HIGH; expiring soon / HTTPS not enforced / actionable chain concern
// = MEDIUM; verified HTTPS behaviour or a neutral cross-host redirect =
// LOW; insufficient evidence = a MEDIUM finding, never a green success.
// Execution status is separate from findings: an expired certificate or
// an HTTP error still yields a COMPLETED report with findings.
export const EXPIRY_WARNING_DAYS = 30;

function finding({ code, severity, title, explanation, evidence = {}, recommendation, confidence = "HIGH" }) {
  return { code, severity, title, explanation, evidence, recommendation, confidence, limitations: null };
}

export function runSslRules({ executionStatus, chain = [], tlsOutcome = null, terminalReason = null, initialScheme = null, finalScheme = null } = {}) {
  const findings = [];
  const hops = Array.isArray(chain) ? chain : [];
  const crossHost = hops.some((h) => h.hostChanged === true);
  const redirectCount = hops.length > 0 ? hops.length - 1 : 0;
  const finalHop = hops[hops.length - 1] || null;

  // ---- TLS findings (from the final TLS outcome only; per-hop TLS
  // results are preserved in the chain for inspection) ----
  if (tlsOutcome && tlsOutcome.scheme === "https") {
    if (tlsOutcome.verified === true && tlsOutcome.certificate) {
      const days = tlsOutcome.daysToExpiry;
      if (typeof days === "number" && days <= EXPIRY_WARNING_DAYS) {
        findings.push(finding({
          code: "TLS_CERT_EXPIRING_SOON",
          severity: "MEDIUM",
          title: "TLS certificate expires soon",
          explanation: `The verified certificate for ${tlsOutcome.certificate.hostname ?? "the site"} expires on ${tlsOutcome.certificate.validTo ?? "an unknown date"} (${days} day(s) remaining). A verified certificate that is about to expire is not yet expired, but renewal should be arranged before expiry to avoid an outage.`,
          evidence: { validTo: tlsOutcome.certificate.validTo ?? null, daysToExpiry: days, protocol: tlsOutcome.certificate.protocol ?? null },
          recommendation: "Renew the certificate before it expires and re-run this check to confirm the new certificate verifies.",
          confidence: "HIGH",
        }));
      } else {
        findings.push(finding({
          code: "TLS_CERT_VALID",
          severity: "LOW",
          title: "TLS certificate verified",
          explanation: `The certificate for ${tlsOutcome.certificate.hostname ?? "the site"} verified against the default trusted CA store, including hostname verification, and is currently within its validity period${typeof days === "number" ? ` (${days} day(s) remaining)` : ""}.`,
          evidence: { validFrom: tlsOutcome.certificate.validFrom ?? null, validTo: tlsOutcome.certificate.validTo ?? null, daysToExpiry: days, protocol: tlsOutcome.certificate.protocol ?? null, cipher: tlsOutcome.certificate.cipher ?? null },
          recommendation: "No certificate action is needed. Re-check before the expiry date shown.",
          confidence: "HIGH",
        }));
      }
    } else if (tlsOutcome.verified === false) {
      const errorCode = tlsOutcome.errorCode || "TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT";
      const isValidationFailure = ["TLS_CERT_EXPIRED", "TLS_CERT_NOT_YET_VALID", "TLS_HOSTNAME_MISMATCH", "TLS_CERT_UNTRUSTED"].includes(errorCode);
      const titles = {
        TLS_CERT_EXPIRED: "TLS certificate has expired",
        TLS_CERT_NOT_YET_VALID: "TLS certificate is not yet valid",
        TLS_HOSTNAME_MISMATCH: "TLS certificate does not match the hostname",
        TLS_CERT_UNTRUSTED: "TLS certificate is not trusted",
        TLS_HANDSHAKE_FAILED: "TLS handshake failed",
        TLS_TIMEOUT: "TLS handshake timed out",
        TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT: "TLS certificate evidence is insufficient",
      };
      findings.push(finding({
        code: errorCode,
        severity: isValidationFailure ? "HIGH" : "MEDIUM",
        title: titles[errorCode] || "TLS certificate could not be verified",
        explanation: errorCode === "TLS_CERT_EXPIRED"
          ? "The server presented a certificate whose validity period has ended, so the TLS handshake could not verify. Visitors' browsers will show a security warning."
          : errorCode === "TLS_CERT_NOT_YET_VALID"
            ? "The server presented a certificate whose validity period has not started yet, so the TLS handshake could not verify."
            : errorCode === "TLS_HOSTNAME_MISMATCH"
              ? "The server presented a certificate that does not cover the requested hostname (subject alternative names do not match), so the TLS handshake could not verify."
              : errorCode === "TLS_CERT_UNTRUSTED"
                ? "The server presented a certificate that does not chain to a trusted certificate authority (for example a self-signed certificate), so the TLS handshake could not verify."
                : errorCode === "TLS_TIMEOUT"
                  ? "The TLS handshake did not complete within the timeout, so no certificate could be verified."
                  : errorCode === "TLS_HANDSHAKE_FAILED"
                    ? "The TLS handshake failed before a certificate could be verified. No certificate details are recorded for an unverified handshake."
                    : "The TLS check could not obtain verifiable certificate evidence. No certificate details are recorded, and no certificate conclusion is drawn.",
        evidence: { errorCode, verified: false },
        recommendation: errorCode === "TLS_CERT_EXPIRED" || errorCode === "TLS_CERT_NOT_YET_VALID"
          ? "Replace the certificate with one that is currently valid for this hostname, then re-run this check."
          : errorCode === "TLS_HOSTNAME_MISMATCH"
            ? "Obtain a certificate that covers this exact hostname (including its subject alternative names), then re-run this check."
            : errorCode === "TLS_CERT_UNTRUSTED"
              ? "Install a certificate issued by a publicly trusted certificate authority for this hostname, then re-run this check."
              : "Investigate the server's TLS configuration and network reachability, then re-run this check.",
        confidence: errorCode === "TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT" ? "MEDIUM" : "HIGH",
      }));
    }
  }

  // ---- Redirect findings ----
  if (terminalReason === "DOWNGRADE_BLOCKED") {
    findings.push(finding({
      code: "DOWNGRADE_DETECTED_BLOCKED",
      severity: "HIGH",
      title: "HTTPS to HTTP downgrade detected and blocked",
      explanation: "A redirect in the chain attempted to move from HTTPS to plain HTTP. The downgrade hop was recorded and NOT followed, so no request was sent over plain HTTP as a result of that redirect.",
      evidence: { redirectCount },
      recommendation: "Fix the redirect on the site so it stays on HTTPS; a downgrade exposes subsequent traffic to interception and modification.",
      confidence: "HIGH",
    }));
  }
  if (terminalReason === "LOOP") {
    findings.push(finding({
      code: "REDIRECT_LOOP",
      severity: "MEDIUM",
      title: "Redirect loop detected",
      explanation: "The redirect chain returned to a URL already visited, so the check stopped instead of following the loop indefinitely.",
      evidence: { redirectCount },
      recommendation: "Fix the redirect rules on the site so the chain terminates at a final page.",
      confidence: "HIGH",
    }));
  }
  if (terminalReason === "MAX_REDIRECTS") {
    findings.push(finding({
      code: "MAX_REDIRECTS_REACHED",
      severity: "MEDIUM",
      title: "Redirect limit reached",
      explanation: "The chain exceeded the maximum of 5 redirects, so the check stopped before reaching a final page.",
      evidence: { redirectCount },
      recommendation: "Shorten the redirect chain on the site (ideally to a single redirect) and re-run this check.",
      confidence: "HIGH",
    }));
  }
  if (terminalReason === "DESTINATION_REJECTED") {
    findings.push(finding({
      code: "REDIRECT_DESTINATION_REJECTED",
      severity: "MEDIUM",
      title: "Redirect destination rejected by the safety policy",
      explanation: "A redirect pointed to a destination that the safety policy rejects (for example a private, loopback, or otherwise non-public address, an unsupported scheme, or a disallowed port). That hop was not followed.",
      evidence: { redirectCount },
      recommendation: "Point the redirect at a publicly reachable HTTPS URL and re-run this check.",
      confidence: "HIGH",
    }));
  }
  if ((terminalReason === "NETWORK_OR_TIMEOUT" || terminalReason === "DNS_FAILURE") && tlsOutcome?.errorCode !== "TLS_TIMEOUT") {
    findings.push(finding({
      code: "NETWORK_OR_TIMEOUT",
      severity: "MEDIUM",
      title: "Connection or timeout failure",
      explanation: "The check could not complete a connection (network failure, DNS failure, or timeout) before reaching a final page. No HTTP status is claimed for a connection that never produced a response.",
      evidence: { redirectCount },
      recommendation: "Check that the site is reachable and its DNS resolves publicly, then re-run this check.",
      confidence: "MEDIUM",
    }));
  }
  if (crossHost) {
    findings.push(finding({
      code: "CROSS_HOST_REDIRECT",
      severity: "LOW",
      title: "Redirect changes hostname",
      explanation: "At least one redirect in the chain moves to a different hostname. This is reported neutrally: a cross-host redirect is common (for example www to apex, or to a CDN) and is not, on its own, evidence of anything malicious.",
      evidence: { redirectCount, hostChanged: true },
      recommendation: "Confirm the destination hostname is the intended one; no action is needed if it is.",
      confidence: "HIGH",
    }));
  }
  // HTTPS-enforcement findings only when a terminal HTTP outcome exists
  // (or the chain ended on HTTP without a downgrade block).
  if (initialScheme === "http" && finalHop) {
    if (finalScheme === "https") {
      findings.push(finding({
        code: "HTTP_TO_HTTPS_REDIRECT",
        severity: "LOW",
        title: "HTTP redirects to HTTPS",
        explanation: "The plain-HTTP target redirected to HTTPS, so visitors who arrive over HTTP are upgraded to an encrypted connection.",
        evidence: { redirectCount, finalUrl: finalHop.url ?? null },
        recommendation: "No action is needed. Consider also sending a Strict-Transport-Security header (this check does not verify headers).",
        confidence: "HIGH",
      }));
    } else if (finalScheme === "http" && terminalReason !== "DOWNGRADE_BLOCKED") {
      findings.push(finding({
        code: "HTTPS_NOT_ENFORCED",
        severity: "MEDIUM",
        title: "HTTPS is not enforced",
        explanation: "The target was reached over plain HTTP and never redirected to HTTPS, so traffic to this URL is not encrypted.",
        evidence: { redirectCount, finalUrl: finalHop.url ?? null },
        recommendation: "Add a redirect from HTTP to the HTTPS version of the site and re-run this check.",
        confidence: "HIGH",
      }));
    }
  }
  if (
    (executionStatus === "COMPLETED" || executionStatus === "PARTIAL") &&
    terminalReason !== "DOWNGRADE_BLOCKED" &&
    terminalReason !== "LOOP" &&
    terminalReason !== "MAX_REDIRECTS" &&
    terminalReason !== "DESTINATION_REJECTED" &&
    !findings.some((f) => f.code === "REDIRECT_CHAIN_OK")
  ) {
    // Chain-ok is only claimed when a terminal response was actually
    // reached (not when the chain stopped early for a covered reason).
    if (terminalReason === "TERMINAL_RESPONSE" || (executionStatus === "COMPLETED" && finalHop && typeof finalHop.status === "number")) {
      findings.push(finding({
        code: "REDIRECT_CHAIN_OK",
        severity: "LOW",
        title: "Redirect chain completed",
        explanation: `The redirect chain completed with ${redirectCount} redirect(s) and reached a final HTTP response (status ${finalHop.status}).`,
        evidence: { redirectCount, finalStatus: finalHop.status ?? null },
        recommendation: "No redirect-chain action is needed.",
        confidence: "HIGH",
      }));
    }
  }
  if ((executionStatus === "PARTIAL" || executionStatus === "FAILED") && findings.length === 0) {
    findings.push(finding({
      code: "INCOMPLETE_EVIDENCE",
      severity: "MEDIUM",
      title: "Evidence is incomplete",
      explanation: "The check could not gather enough evidence to draw a conclusion. This is not a pass and not a confirmed defect — it means the check did not complete.",
      evidence: { executionStatus, terminalReason },
      recommendation: "Re-run the check; if the problem persists, investigate reachability and TLS configuration.",
      confidence: "MEDIUM",
    }));
  }
  return findings;
}
