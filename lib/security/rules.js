// Tool 08 deterministic finding engine (Milestone 12). Pure — no I/O, no
// network, no mutation, no exploit, no login, no form submission. Input is
// the normalized snapshot interpretation + provider match results +
// passive HTTP observations. Evidence vocabulary mirrors Tools 02-07:
// CONFIRMED (directly observed/matched), POTENTIAL (observed state that
// could matter but is not proven exploitable), INSUFFICIENT_EVIDENCE.
// Hard invariants:
//  - a version-matched advisory is a POTENTIAL vulnerability (a match in
//    a checked source), never a proven exploit — exploitability is never
//    claimed and never tested;
//  - outdated != vulnerable; no matching advisory != safe;
//  - missing/weak header != confirmed vulnerability;
//  - HTTP 200 on a sensitive path without a signature != confirmed leak;
//  - 403/404 on a sensitive path != proof of absence;
//  - a missing optional security flag never invalidates the whole scan;
//  - provider failure never produces a clean scan (PARTIAL + limitation).

function finding({ code, severity, title, explanation, evidence = {}, recommendation, confidence = "HIGH", evidenceStatus = "CONFIRMED", advisory = null, limitations = null }) {
  return { code, severity, title, explanation, evidence, recommendation, confidence, evidenceStatus, advisory, limitations };
}

function severityForCvss(score, severityLabel) {
  if (typeof score === "number") {
    if (score >= 9.0) return "CRITICAL";
    if (score >= 7.0) return "HIGH";
    if (score >= 4.0) return "MEDIUM";
    if (score > 0) return "LOW";
  }
  const label = typeof severityLabel === "string" ? severityLabel.toLowerCase() : "";
  if (label === "c" || label === "critical") return "CRITICAL";
  if (label === "h" || label === "high") return "HIGH";
  if (label === "m" || label === "medium") return "MEDIUM";
  if (label === "l" || label === "low") return "LOW";
  return "HIGH"; // matched advisory with no supplied score: do not downplay
}

export function headerFindings(homepage) {
  const findings = [];
  if (homepage?.error || homepage?.status === null || homepage?.status === undefined) {
    findings.push(finding({
      code: "SECURITY_CHECK_NOT_RUN", severity: "LOW",
      title: "Security-header check could not run",
      explanation: "The homepage could not be fetched through the safe scanner, so security headers could not be observed. This is a coverage gap, not a pass.",
      evidence: { check: "security-headers", error: homepage?.error ?? "NO_RESPONSE" },
      recommendation: "Check the site is publicly reachable, then re-run the scan.",
      confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
    }));
    return findings;
  }
  const h = {};
  for (const [k, v] of Object.entries(homepage.headers ?? {})) h[String(k).toLowerCase()] = v;
  const present = (name) => typeof h[name] === "string" && h[name].trim() !== "";
  // HSTS is only meaningful over HTTPS; on plain HTTP its absence is
  // reported as missing with that explanation, not as a TLS failure.
  if (!present("strict-transport-security")) {
    findings.push(finding({
      code: "SECURITY_HEADER_MISSING", severity: "LOW",
      title: "Strict-Transport-Security header missing",
      explanation: "The homepage response carried no Strict-Transport-Security header, so browsers are not instructed to use HTTPS only for this host. This is a hardening gap, not a confirmed vulnerability.",
      evidence: { header: "Strict-Transport-Security", finalUrlScheme: homepage.finalUrl?.startsWith("https:") ? "https" : "http" },
      recommendation: "If the site is served over HTTPS, add a Strict-Transport-Security header with a long max-age (for example max-age=31536000) and includeSubDomains once HTTPS is confirmed everywhere.",
      confidence: "HIGH", evidenceStatus: "CONFIRMED",
    }));
  } else {
    const maxAge = /max-age\s*=\s*(\d+)/i.exec(h["strict-transport-security"]);
    if (!maxAge || Number(maxAge[1]) < 31536000) {
      findings.push(finding({
        code: "SECURITY_HEADER_WEAK_POLICY", severity: "LOW",
        title: "Strict-Transport-Security policy is short-lived",
        explanation: "A Strict-Transport-Security header is present but its max-age is below 31536000 seconds, so the protection expires quickly. This is a hardening observation, not a confirmed vulnerability.",
        evidence: { header: "Strict-Transport-Security", value: h["strict-transport-security"].slice(0, 200) },
        recommendation: "Consider raising max-age to at least 31536000 once HTTPS is confirmed across the whole site.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    }
  }
  if (!present("content-security-policy")) {
    findings.push(finding({
      code: "SECURITY_HEADER_MISSING", severity: "LOW",
      title: "Content-Security-Policy header missing",
      explanation: "The homepage response carried no Content-Security-Policy header. This is a hardening gap, not a confirmed vulnerability.",
      evidence: { header: "Content-Security-Policy" },
      recommendation: "Consider adding a Content-Security-Policy appropriate to the site's scripts, styles, and embeds, and test it on staging first.",
      confidence: "HIGH", evidenceStatus: "CONFIRMED",
    }));
  } else if (/\*\s*(;|$)/.test(h["content-security-policy"]) || /unsafe-inline/i.test(h["content-security-policy"])) {
    findings.push(finding({
      code: "SECURITY_HEADER_WEAK_POLICY", severity: "LOW",
      title: "Content-Security-Policy allows broad sources",
      explanation: "A Content-Security-Policy is present but it contains a wildcard source or unsafe-inline, which weakens its protection. A policy differing from one preferred template is not automatically invalid; only these broad allowances are flagged.",
      evidence: { header: "Content-Security-Policy", value: h["content-security-policy"].slice(0, 200) },
      recommendation: "Tighten the policy to named sources where practical, and remove unsafe-inline for scripts and styles if the site allows it.",
      confidence: "MEDIUM", evidenceStatus: "POTENTIAL",
    }));
  }
  if (!present("x-content-type-options")) {
    findings.push(finding({
      code: "SECURITY_HEADER_MISSING", severity: "LOW",
      title: "X-Content-Type-Options header missing",
      explanation: "The homepage response carried no X-Content-Type-Options header, so browsers may MIME-sniff responses. This is a hardening gap, not a confirmed vulnerability.",
      evidence: { header: "X-Content-Type-Options" },
      recommendation: "Add X-Content-Type-Options: nosniff.",
      confidence: "HIGH", evidenceStatus: "CONFIRMED",
    }));
  } else if (h["x-content-type-options"].trim().toLowerCase() !== "nosniff") {
    findings.push(finding({
      code: "SECURITY_HEADER_WEAK_POLICY", severity: "LOW",
      title: "X-Content-Type-Options is not nosniff",
      explanation: "X-Content-Type-Options is present but is not nosniff, so MIME-sniffing protection may not apply.",
      evidence: { header: "X-Content-Type-Options", value: h["x-content-type-options"].slice(0, 200) },
      recommendation: "Set X-Content-Type-Options: nosniff.",
      confidence: "HIGH", evidenceStatus: "CONFIRMED",
    }));
  }
  // Framing: X-Frame-Options OR an effective CSP frame-ancestors satisfies
  // the check. Missing both is a finding; a differing value is weak only
  // when X-Frame-Options is present with an unexpected value.
  const csp = h["content-security-policy"] ?? "";
  const hasFrameAncestors = /frame-ancestors/i.test(csp);
  if (!present("x-frame-options") && !hasFrameAncestors) {
    findings.push(finding({
      code: "SECURITY_HEADER_MISSING", severity: "LOW",
      title: "Framing protection header missing",
      explanation: "Neither X-Frame-Options nor a Content-Security-Policy frame-ancestors directive was observed, so the page may be frameable by other sites. This is a hardening gap, not a confirmed vulnerability.",
      evidence: { header: "X-Frame-Options / frame-ancestors" },
      recommendation: "Add X-Frame-Options: SAMEORIGIN (or DENY) or a CSP frame-ancestors directive, unless the site intentionally allows framing.",
      confidence: "HIGH", evidenceStatus: "CONFIRMED",
    }));
  } else if (present("x-frame-options") && !/^(deny|sameorigin)$/i.test(h["x-frame-options"].trim())) {
    findings.push(finding({
      code: "SECURITY_HEADER_WEAK_POLICY", severity: "LOW",
      title: "X-Frame-Options value is unexpected",
      explanation: "X-Frame-Options is present with a value other than DENY or SAMEORIGIN, so its framing protection is unclear.",
      evidence: { header: "X-Frame-Options", value: h["x-frame-options"].slice(0, 200) },
      recommendation: "Use X-Frame-Options: DENY or SAMEORIGIN, or rely on a CSP frame-ancestors directive instead.",
      confidence: "MEDIUM", evidenceStatus: "POTENTIAL",
    }));
  }
  if (!present("referrer-policy")) {
    findings.push(finding({
      code: "SECURITY_HEADER_MISSING", severity: "LOW",
      title: "Referrer-Policy header missing",
      explanation: "The homepage response carried no Referrer-Policy header, so browsers use their default referrer behaviour. This is a hardening gap, not a confirmed vulnerability.",
      evidence: { header: "Referrer-Policy" },
      recommendation: "Consider adding a Referrer-Policy such as strict-origin-when-cross-origin.",
      confidence: "HIGH", evidenceStatus: "CONFIRMED",
    }));
  }
  if (!present("permissions-policy")) {
    findings.push(finding({
      code: "SECURITY_HEADER_MISSING", severity: "LOW",
      title: "Permissions-Policy header missing",
      explanation: "The homepage response carried no Permissions-Policy header, so browser features are not explicitly restricted. This is a hardening gap, not a confirmed vulnerability.",
      evidence: { header: "Permissions-Policy" },
      recommendation: "Consider adding a Permissions-Policy restricting features the site does not use (for example camera, microphone, geolocation).",
      confidence: "HIGH", evidenceStatus: "CONFIRMED",
    }));
  }
  return findings;
}

// input: { components: [{productType, slug, name, version, active, updateAvailable, newVersion, status, providerStatus, matchedAdvisories, insufficientAdvisories}],
//   securityIndicators, http: {homepage, xmlrpc, sensitivePaths}, providerStatuses, snapshotSchemaVersion }
export function runSecurityRules(input = {}) {
  const findings = [];
  const components = Array.isArray(input.components) ? input.components : [];
  const indicators = input.securityIndicators ?? null;

  for (const comp of components) {
    const label = comp.name ?? comp.slug ?? comp.productType;
    const codePrefix = comp.productType === "core" ? "WP_CORE" : comp.productType === "plugin" ? "PLUGIN" : "THEME";
    // Provider-level failures are reported once below, not once per
    // component; the outdated check after this chain still runs.
    const providerFailed = ["PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "PROVIDER_ERROR"].includes(comp.status);
    if (!providerFailed && comp.status === "MATCHED_ADVISORY") {
      for (const advisory of comp.matchedAdvisories ?? []) {
        const severity = severityForCvss(advisory.cvssScore, advisory.cvssSeverity);
        findings.push(finding({
          code: `${codePrefix}_KNOWN_VULNERABILITY`, severity,
          title: `${label} ${comp.version ?? ""} matches a known vulnerability advisory`.trim(),
          explanation: `The installed version matches an advisory in the checked source (${advisory.providerId}). This is a version-matched advisory, not proof of exploitation: exploitability was not tested and is never tested by this tool. Treat it as a potential vulnerability until the component is updated or the advisory is otherwise addressed.`,
          evidence: { productType: comp.productType, slug: comp.slug ?? null, version: comp.version ?? null, advisoryId: advisory.advisoryId, cveId: advisory.cveId ?? null, range: advisory.range ?? null, fixedVersion: advisory.fixedVersion ?? null, retrievedAt: advisory.retrievedAt ?? null, sourceUrl: advisory.sourceUrl ?? null },
          recommendation: advisory.fixedVersion
            ? `Update ${label} to version ${advisory.fixedVersion} or later (the advisory's fixed version), on a staging copy first, then sync a fresh snapshot and re-run.`
            : `Update ${label} to the latest available version on a staging copy first (no fixed version is supplied by the checked source for this advisory), then sync a fresh snapshot and re-run.`,
          confidence: "HIGH", evidenceStatus: "POTENTIAL",
          advisory: { advisoryId: advisory.advisoryId, cveId: advisory.cveId ?? null, sourceUrl: advisory.sourceUrl ?? null, fixedVersion: advisory.fixedVersion ?? null, retrievedAt: advisory.retrievedAt ?? null },
          limitations: "A version match in one checked source is not a complete vulnerability assessment: other sources, unpublished issues, and configuration issues are not covered.",
        }));
      }
    } else if (comp.status === "COMPONENT_VERSION_UNKNOWN") {
      findings.push(finding({
        code: "COMPONENT_VERSION_UNKNOWN", severity: "MEDIUM",
        title: `Version of ${label} could not be determined reliably`,
        explanation: "The snapshot reports a missing, prerelease, development, or nonstandard version for this component, so it cannot be matched against advisories and cannot be declared safe. Prerelease and development versions are handled conservatively: no match and no clearance.",
        evidence: { productType: comp.productType, slug: comp.slug ?? null, version: comp.version ?? null },
        recommendation: "Confirm the exact installed version in WordPress, and prefer a stable release; then sync a fresh snapshot and re-run.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    } else if (comp.status === "COMPONENT_IDENTITY_UNCERTAIN") {
      findings.push(finding({
        code: "SECURITY_EVIDENCE_INSUFFICIENT", severity: "MEDIUM",
        title: `Identity of ${label} is uncertain, so advisories could not be checked`,
        explanation: "This component has no canonical slug in the snapshot, so it cannot be queried against the vulnerability source by slug. Matching by display name alone is never done, because names do not identify products reliably. This is a coverage gap, not a pass. (For themes this is expected: the snapshot theme object carries a display name only, with no stylesheet slug.)",
        evidence: { productType: comp.productType, slug: comp.slug ?? null, version: comp.version ?? null },
        recommendation: "Check this component manually against its vendor's security advisories; a future connector schema may supply the theme stylesheet slug so theme checks can run automatically.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    } else if (comp.status === "INSUFFICIENT_EVIDENCE") {
      findings.push(finding({
        code: "SECURITY_EVIDENCE_INSUFFICIENT", severity: "MEDIUM",
        title: `Advisory data for ${label} could not be evaluated`,
        explanation: "Advisories were returned for this component but their version ranges could not be parsed or evaluated, so no match and no clearance is claimed for those advisories.",
        evidence: { productType: comp.productType, slug: comp.slug ?? null, version: comp.version ?? null, insufficient: (comp.insufficientAdvisories ?? []).slice(0, 10) },
        recommendation: "Check this component manually against its vendor's advisories, then sync a fresh snapshot and re-run.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
    // Outdated is a separate, weaker claim than vulnerable — always.
    if (comp.updateAvailable) {
      findings.push(finding({
        code: "COMPONENT_OUTDATED", severity: "LOW",
        title: `${label} has an update available${comp.newVersion ? ` (${comp.newVersion})` : ""}`,
        explanation: "The snapshot's cached update metadata reports an update for this component. Being outdated is not, by itself, evidence of a vulnerability; it only means a newer version exists. Update metadata comes from WordPress's cached transient and may itself be stale.",
        evidence: { productType: comp.productType, slug: comp.slug ?? null, version: comp.version ?? null, newVersion: comp.newVersion ?? null },
        recommendation: "Review the update on a staging copy, then update and sync a fresh snapshot. Do not auto-install from this report.",
        confidence: "MEDIUM", evidenceStatus: "POTENTIAL",
      }));
    }
  }

  // Provider-level findings (one per failing provider state).
  for (const ps of input.providerStatuses ?? []) {
    if (ps.status === "PROVIDER_UNAVAILABLE") {
      findings.push(finding({
        code: "VULNERABILITY_PROVIDER_UNAVAILABLE", severity: "MEDIUM",
        title: "Vulnerability intelligence provider is not available",
        explanation: ps.reason ?? "No vulnerability provider is configured or the configured provider is unsupported, so no advisory matching ran. Advisory checks are therefore not covered by this report — this is never a clean scan.",
        evidence: { providerId: ps.providerId },
        recommendation: "Configure a supported vulnerability provider (WPVulnerability, keyless) and re-run; hardening and passive HTTP checks in this report still stand on their own.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    } else if (ps.status === "PROVIDER_RATE_LIMITED") {
      findings.push(finding({
        code: "VULNERABILITY_PROVIDER_RATE_LIMITED", severity: "MEDIUM",
        title: "Vulnerability provider rate limit reached",
        explanation: "The vulnerability provider rate-limited this scan, so advisory matching is incomplete. No advisory clearance is claimed for components that were not checked.",
        evidence: { providerId: ps.providerId },
        recommendation: "Wait and re-run the scan; the provider's own limits are outside this tool's control.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    } else if (ps.status === "PROVIDER_ERROR") {
      findings.push(finding({
        code: "VULNERABILITY_PROVIDER_UNAVAILABLE", severity: "MEDIUM",
        title: "Vulnerability provider check failed",
        explanation: "The vulnerability provider could not be reached or returned an unusable response, so advisory matching is incomplete. No advisory clearance is claimed.",
        evidence: { providerId: ps.providerId, reason: ps.reason ?? null },
        recommendation: "Re-run the scan; if the provider stays unavailable, check its status page and the components manually.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
  }

  // Hardening indicators (v6 only; missing indicators -> insufficient).
  if (!indicators) {
    findings.push(finding({
      code: "SECURITY_EVIDENCE_INSUFFICIENT", severity: "LOW",
      title: "Security hardening flags are not in this snapshot",
      explanation: "The snapshot predates schema v6 (connector older than 1.5.0), so it carries no WP_DEBUG / file-editing flags. Hardening configuration therefore cannot be assessed from this report — this is a data-availability limit, not evidence of a secure configuration.",
      evidence: { snapshotSchemaVersion: input.snapshotSchemaVersion ?? null },
      recommendation: "Update the WP Doctor AI Connector plugin to 1.5.0 or later, sync a fresh snapshot, and re-run.",
      confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
    }));
  } else {
    if (indicators.wpDebugDisplay === "yes") {
      findings.push(finding({
        code: "WP_DEBUG_DISPLAY_ENABLED", severity: "MEDIUM",
        title: "WP_DEBUG_DISPLAY is enabled",
        explanation: "WordPress is configured to display PHP errors and warnings on pages. On a live site this can leak paths, queries, and internals to visitors. The flag value is reported by the connector; it is not, by itself, proof that sensitive data has leaked.",
        evidence: { flag: "WP_DEBUG_DISPLAY", value: "yes" },
        recommendation: "On a production site, disable WP_DEBUG_DISPLAY (keep WP_DEBUG_LOG for private logging if debugging is needed) and confirm no errors are shown publicly.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    }
    if (indicators.disallowFileEdit === "no") {
      findings.push(finding({
        code: "DASHBOARD_FILE_EDITING_ENABLED", severity: "LOW",
        title: "Dashboard file editing is not disabled",
        explanation: "DISALLOW_FILE_EDIT is not set, so the WordPress dashboard file editor remains available to administrators. This is a hardening observation: it only matters if an administrator account is compromised, and disabling it alone does not secure a site.",
        evidence: { flag: "DISALLOW_FILE_EDIT", value: "no" },
        recommendation: "Consider defining DISALLOW_FILE_EDIT as true in wp-config.php if the dashboard editor is not needed, and protect administrator accounts with strong credentials and two-factor authentication.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    }
    for (const key of ["wpDebug", "wpDebugLog", "wpDebugDisplay", "disallowFileEdit"]) {
      if (indicators[key] !== "yes" && indicators[key] !== "no") {
        findings.push(finding({
          code: "SECURITY_EVIDENCE_INSUFFICIENT", severity: "LOW",
          title: `Security flag ${key} is unknown in this snapshot`,
          explanation: "The connector could not determine this flag's value, so no conclusion is drawn from it.",
          evidence: { flag: key, value: indicators[key] ?? null },
          recommendation: "Check the flag manually in the site's configuration if it matters to the review.",
          confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
        }));
      }
    }
  }

  // Passive HTTP observations.
  const http = input.http ?? {};
  findings.push(...headerFindings(http.homepage));
  if (http.xmlrpc?.responds) {
    findings.push(finding({
      code: "XMLRPC_ENDPOINT_RESPONDS", severity: "LOW",
      title: "XML-RPC endpoint responds to unauthenticated requests",
      explanation: "An unauthenticated GET to /xmlrpc.php received a response (200 or 405), so the endpoint is reachable. This is an observation, not a vulnerability: XML-RPC is legitimately used by the WordPress mobile apps and some integrations, and disabling it is NOT automatically recommended. Only the endpoint's reachability was observed — no method was called and no authentication was attempted.",
      evidence: { path: "/xmlrpc.php", status: http.xmlrpc.status },
      recommendation: "If no app or integration uses XML-RPC, consider restricting or disabling it at the server level; if one does, leave it enabled and protect the site by other means.",
      confidence: "HIGH", evidenceStatus: "CONFIRMED",
    }));
  } else if (http.xmlrpc?.error) {
    findings.push(finding({
      code: "SECURITY_CHECK_NOT_RUN", severity: "LOW",
      title: "XML-RPC check could not run",
      explanation: "The XML-RPC observation failed, so no conclusion is drawn about the endpoint.",
      evidence: { check: "xmlrpc", error: http.xmlrpc.error },
      recommendation: "Check the site is publicly reachable, then re-run.",
      confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
    }));
  }
  for (const p of http.sensitivePaths ?? []) {
    if (p.result === "CONFIRMED") {
      findings.push(finding({
        code: "SENSITIVE_FILE_EXPOSURE_CONFIRMED", severity: "HIGH",
        title: `Sensitive file appears publicly exposed: ${p.path}`,
        explanation: "A public request to this path returned a 200 response whose first bytes matched the expected signature for this file type. Only the classification is stored — the response body itself was discarded immediately and is never shown, logged, or stored. Remove or block public access to this file and rotate any credentials that may have been in it.",
        evidence: { path: p.path, status: p.status, contentTypeCategory: p.contentTypeCategory },
        recommendation: "Block public access to this path at the server level, remove the file if it is not needed, and rotate any credentials or keys that could have been exposed.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (p.result === "POSSIBLE_EXPOSURE") {
      findings.push(finding({
        code: "SENSITIVE_FILE_POSSIBLE_EXPOSURE", severity: "MEDIUM",
        title: `Possible exposure needs confirmation: ${p.path}`,
        explanation: "A public request to this path returned a 200 response, but its first bytes did not match the expected signature for this file type, so exposure is NOT confirmed — the response may be a custom error page served with a 200 status. Confirm manually before acting.",
        evidence: { path: p.path, status: p.status, contentTypeCategory: p.contentTypeCategory },
        recommendation: "Fetch this path manually (without credentials) and confirm whether it serves the sensitive file or a generic page; block it at the server level if it serves the file.",
        confidence: "MEDIUM", evidenceStatus: "POTENTIAL",
      }));
    } else if (p.result === "NOT_RUN") {
      findings.push(finding({
        code: "SECURITY_CHECK_NOT_RUN", severity: "LOW",
        title: `Sensitive-path check could not run: ${p.path}`,
        explanation: "The probe for this path failed, so no conclusion is drawn about it.",
        evidence: { path: p.path, error: p.reason ?? null },
        recommendation: "Check the site is publicly reachable, then re-run.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
  }
  return findings;
}
