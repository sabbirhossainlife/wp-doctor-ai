// Pure, deterministic classification of Milestone 2 scanner results into
// Tool 01 diagnostic reports. No I/O, no network, no AI.
// Two statuses are kept strictly apart:
//   executionStatus — did the SCAN itself run? COMPLETED / FAILED / BLOCKED
//   diagnosticOutcome — what did we OBSERVE about the website?
// A website returning HTTP 500 is a COMPLETED scan with an HTTP error
// finding, never a scanner failure. A timeout is a timeout: recommendations
// say "check" and "consider", never "your hosting server is broken".
// No TLS status is ever claimed: the M2 scanner collects no TLS detail, so
// the only TLS statement a report may make is a TLS_FAILURE error code.

export const SCAN_LIMITATION_NOTE =
  "A public URL check cannot reveal private PHP errors, database problems, " +
  "or every plugin conflict. If the cause is still unclear, authorized " +
  "diagnostics from the WordPress connector (a later milestone) may be needed.";

function finding(title, description, severity, status, evidence, recommendation) {
  return { title, description, severity, status, evidence, recommendation };
}

// Classify a successful scanUrl result:
// { finalUrl, finalStatus, redirectCount, chain, durationMs }
export function classifySuccess(result) {
  const status = result.finalStatus;
  const chainEvidence = {
    redirectCount: result.redirectCount ?? 0,
    hops: (result.chain || []).map((hop) => ({
      url: hop.url,
      protocol: hop.protocol,
      status: hop.status,
      contentType: hop.contentType ?? null,
      bodyBytes: hop.bodyBytes ?? null,
    })),
  };
  const findings = [];
  if (result.redirectCount > 0) {
    findings.push(
      finding(
        `Redirect chain observed (${result.redirectCount} redirect${result.redirectCount === 1 ? "" : "s"})`,
        `The request followed ${result.redirectCount} redirect${result.redirectCount === 1 ? "" : "s"} before reaching the final response. Each redirect was re-validated against the scanner security policy.`,
        "info",
        "CONFIRMED",
        chainEvidence,
        "If a redirect is unexpected, check the site's redirect settings for the hop that looks wrong.",
      ),
    );
  }
  if (status >= 200 && status < 300) {
    findings.push(
      finding(
        `HTTP ${status} — request succeeded`,
        `The website responded with HTTP ${status} to the diagnostic request. This confirms the site answered over HTTP; it does not confirm every page, plugin, or checkout flow works.`,
        "info",
        "CONFIRMED",
        chainEvidence,
        "No action needed for availability based on this check alone.",
      ),
    );
    return {
      executionStatus: "COMPLETED",
      diagnosticOutcome: "REACHABLE",
      findings,
    };
  }
  if (status >= 300 && status < 400) {
    findings.push(
      finding(
        `HTTP ${status} redirect without a usable redirect target`,
        `The website returned HTTP ${status} but no redirect target the scanner could follow, so no final content response was observed.`,
        "medium",
        "WARNING",
        chainEvidence,
        "Check the site's redirect configuration for this URL.",
      ),
    );
    return {
      executionStatus: "COMPLETED",
      diagnosticOutcome: "REDIRECT_PROBLEM",
      findings,
    };
  }
  if (status === 404) {
    findings.push(
      finding(
        "HTTP 404 — page not found",
        "The website answered, but the requested URL returned HTTP 404. The server itself responded; the specific path was not found.",
        "medium",
        "CONFIRMED",
        chainEvidence,
        "Check whether the URL path is correct, whether the page was moved or deleted, and whether a redirect to the new location is needed.",
      ),
    );
  } else if (status >= 400 && status < 500) {
    findings.push(
      finding(
        `HTTP ${status} — client error response`,
        `The website answered with HTTP ${status}. The request reached the server, but the server refused it or could not serve this URL.`,
        "medium",
        "CONFIRMED",
        chainEvidence,
        "Check the URL, access rules, and the server error log for this request.",
      ),
    );
  } else if (status >= 500) {
    findings.push(
      finding(
        `HTTP ${status} — server error response`,
        `The website answered with HTTP ${status}. This is an observed server error response for this URL; it does not by itself identify which plugin, theme, or server component caused it.`,
        "high",
        "CONFIRMED",
        chainEvidence,
        "Check the server and PHP error logs around the time of this scan, and consider disabling recently updated plugins or themes on a staging copy first.",
      ),
    );
  } else {
    findings.push(
      finding(
        `HTTP ${status} — unexpected response`,
        `The website returned HTTP ${status}, which this checker does not map to a specific diagnosis.`,
        "medium",
        "WARNING",
        chainEvidence,
        "Re-run the check and inspect the server response for this URL.",
      ),
    );
  }
  return {
    executionStatus: "COMPLETED",
    diagnosticOutcome: "HTTP_ERROR_RESPONSE",
    findings,
  };
}

// Classify a scanner failure (ScannerError code) into execution + outcome.
export function classifyError(code) {
  const blocked = new Set([
    "INVALID_URL",
    "UNSUPPORTED_SCHEME",
    "UNSUPPORTED_PORT",
    "PROHIBITED_DESTINATION",
  ]);
  const table = {
    INVALID_URL: {
      outcome: "BLOCKED_BY_SECURITY_POLICY",
      title: "Scan blocked — invalid URL",
      description:
        "The submitted URL could not be parsed or normalized safely, so no request was made.",
      severity: "medium",
      recommendation:
        "Submit a complete http:// or https:// URL without embedded credentials.",
    },
    UNSUPPORTED_SCHEME: {
      outcome: "BLOCKED_BY_SECURITY_POLICY",
      title: "Scan blocked — unsupported scheme",
      description: "Only http and https URLs can be scanned.",
      severity: "medium",
      recommendation: "Submit an http:// or https:// URL.",
    },
    UNSUPPORTED_PORT: {
      outcome: "BLOCKED_BY_SECURITY_POLICY",
      title: "Scan blocked — unsupported port",
      description:
        "Only the standard ports are supported (80 for http, 443 for https).",
      severity: "medium",
      recommendation: "Submit the URL without a custom port.",
    },
    PROHIBITED_DESTINATION: {
      outcome: "BLOCKED_BY_SECURITY_POLICY",
      title: "Scan blocked — destination not publicly reachable",
      description:
        "The destination was rejected by the scanner security policy before any connection was made. No request reached the target.",
      severity: "medium",
      recommendation:
        "Submit a publicly reachable website URL. Private, local, and internal addresses cannot be scanned.",
    },
    DNS_FAILURE: {
      outcome: "DNS_FAILURE",
      title: "DNS lookup failed",
      description:
        "The hostname could not be resolved safely. This may mean the domain does not exist, DNS is misconfigured, or resolution timed out.",
      severity: "high",
      recommendation:
        "Check the domain's DNS records and nameservers, and confirm the domain is spelled correctly.",
    },
    CONNECTION_FAILURE: {
      outcome: "CONNECTION_FAILURE",
      title: "Connection failed",
      description:
        "The scanner could not establish a connection to the destination. The cause was not observed beyond the failed connection.",
      severity: "high",
      recommendation:
        "Check whether the site is online, the firewall allows web traffic, and the server is listening on the standard web port.",
    },
    TLS_FAILURE: {
      outcome: "TLS_FAILURE",
      title: "TLS verification failed",
      description:
        "The destination's TLS certificate could not be verified. No TLS details beyond this failure are collected by the scanner.",
      severity: "high",
      recommendation:
        "Check the site's TLS certificate (expiry, hostname match, and chain) with the hosting provider or certificate issuer.",
    },
    REQUEST_TIMEOUT: {
      outcome: "TIMEOUT",
      title: "Request timed out",
      description:
        "The destination did not respond within the scanner time limit. This is an observed timeout only; it does not by itself prove what is slow or broken.",
      severity: "medium",
      recommendation:
        "Re-run the check, and if timeouts persist, check server load and response times with the hosting provider.",
    },
    TOO_MANY_REDIRECTS: {
      outcome: "REDIRECT_PROBLEM",
      title: "Too many redirects or a redirect loop",
      description:
        "The redirect chain exceeded the limit or looped back on itself, so no final response was observed.",
      severity: "medium",
      recommendation:
        "Check the site's redirect rules for a loop (for example, two pages redirecting to each other).",
    },
    RESPONSE_LIMIT_EXCEEDED: {
      outcome: "INSUFFICIENT_EVIDENCE",
      title: "Response too large to inspect",
      description:
        "The response exceeded the scanner size limit, so it was discarded without being stored. No finding about the content can be made from it.",
      severity: "medium",
      recommendation:
        "Re-run the check; if the URL normally returns a very large response, check a smaller or more specific URL.",
    },
    RATE_LIMITED: {
      outcome: "INSUFFICIENT_EVIDENCE",
      title: "Scan rate limit reached",
      description:
        "Too many scan requests were made in a short period, so this scan was not run.",
      severity: "low",
      recommendation: "Wait a short while and try again.",
    },
    CONCURRENCY_LIMIT_REACHED: {
      outcome: "INSUFFICIENT_EVIDENCE",
      title: "Too many scans running",
      description:
        "Too many scans are running at once, so this scan was not run.",
      severity: "low",
      recommendation: "Wait a short while and try again.",
    },
    INTERNAL_SCANNER_ERROR: {
      outcome: "INSUFFICIENT_EVIDENCE",
      title: "Scan could not be completed",
      description:
        "An internal scanner error prevented this scan from completing. No conclusion about the website can be drawn from it.",
      severity: "medium",
      recommendation: "Re-run the check; if the error persists, report it with the scan ID.",
    },
  };
  const entry = table[code] || table.INTERNAL_SCANNER_ERROR;
  return {
    executionStatus: blocked.has(code) ? "BLOCKED" : "FAILED",
    diagnosticOutcome: entry.outcome,
    findings: [
      finding(
        entry.title,
        entry.description,
        entry.severity,
        "WARNING",
        { errorCode: code },
        entry.recommendation,
      ),
    ],
  };
}
