// Tool 08 rules engine tests (Milestone 12).
import test from "node:test";
import assert from "node:assert/strict";
import { runSecurityRules, headerFindings } from "../lib/security/rules.js";
import { classifySensitivePath } from "../lib/security/http.js";

const SENTINEL = "SENTINEL_SECRET_XYZ_9f8e7d";

function baseInput(overrides = {}) {
  return {
    components: [],
    securityIndicators: { wpDebug: "no", wpDebugDisplay: "no", wpDebugLog: "no", disallowFileEdit: "yes" },
    snapshotSchemaVersion: 6,
    providerStatuses: [{ providerId: "wpvulnerability", status: "OK" }],
    http: {
      homepage: { finalUrl: "https://example.com/", status: 200, headers: { "strict-transport-security": "max-age=31536000; includeSubDomains", "content-security-policy": "default-src 'self'", "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN", "referrer-policy": "strict-origin-when-cross-origin", "permissions-policy": "camera=()" }, redirectCount: 0, crossHostRedirect: false, error: null },
      xmlrpc: { status: 404, responds: false, error: null },
      sensitivePaths: [],
    },
    ...overrides,
  };
}

test("clean inputs produce no findings (and no false secure badge is implied by the engine)", () => {
  assert.deepEqual(runSecurityRules(baseInput()), []);
});

test("matched advisory: severity from CVSS, fixed version only when supplied, potential not proven", () => {
  const findings = runSecurityRules(baseInput({
    components: [{ productType: "plugin", slug: "akismet", name: "Akismet", version: "3.1.4", status: "MATCHED_ADVISORY", matchedAdvisories: [{ advisoryId: "uuid-1", cveId: "CVE-2015-9357", cvssScore: 9.8, cvssSeverity: "c", fixedVersion: "3.1.5", sourceUrl: "https://example.com/cve", retrievedAt: "2026-10-28T00:00:00.000Z" }], insufficientAdvisories: [] }],
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "PLUGIN_KNOWN_VULNERABILITY");
  assert.equal(findings[0].severity, "CRITICAL");
  assert.equal(findings[0].evidenceStatus, "POTENTIAL");
  assert.match(findings[0].explanation, /not proof of exploitation/);
  assert.equal(findings[0].advisory.fixedVersion, "3.1.5");
  assert.equal(findings[0].advisory.cveId, "CVE-2015-9357");
});

test("matched advisory without a score is not downplayed", () => {
  const findings = runSecurityRules(baseInput({
    components: [{ productType: "core", slug: null, name: "WordPress core", version: "5.8.2", status: "MATCHED_ADVISORY", matchedAdvisories: [{ advisoryId: "c1", cveId: null, cvssScore: null, cvssSeverity: null, fixedVersion: null, sourceUrl: null, retrievedAt: null }], insufficientAdvisories: [] }],
  }));
  assert.equal(findings[0].code, "WP_CORE_KNOWN_VULNERABILITY");
  assert.equal(findings[0].severity, "HIGH");
});

test("outdated is a separate LOW finding and never implies vulnerability", () => {
  const findings = runSecurityRules(baseInput({
    components: [{ productType: "plugin", slug: "x", name: "X", version: "1.0", updateAvailable: true, newVersion: "1.1", status: "NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES", matchedAdvisories: [], insufficientAdvisories: [] }],
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "COMPONENT_OUTDATED");
  assert.match(findings[0].explanation, /not, by itself, evidence of a vulnerability/);
});

test("theme identity uncertain + version unknown + insufficient evidence are findings, not passes", () => {
  const findings = runSecurityRules(baseInput({
    components: [
      { productType: "theme", slug: null, name: "Oishi", version: "1.0", status: "COMPONENT_IDENTITY_UNCERTAIN", matchedAdvisories: [], insufficientAdvisories: [] },
      { productType: "plugin", slug: "y", name: "Y", version: "1.0-beta1", status: "COMPONENT_VERSION_UNKNOWN", matchedAdvisories: [], insufficientAdvisories: [] },
    ],
  }));
  assert.ok(findings.some((f) => f.code === "SECURITY_EVIDENCE_INSUFFICIENT"));
  assert.ok(findings.some((f) => f.code === "COMPONENT_VERSION_UNKNOWN"));
});

test("provider unavailable produces a provider finding and no clean scan; component provider-failures are not duplicated", () => {
  const findings = runSecurityRules(baseInput({
    providerStatuses: [{ providerId: "wpvulnerability", status: "PROVIDER_UNAVAILABLE", reason: "off" }],
    components: [{ productType: "plugin", slug: "x", name: "X", version: "1.0", status: "PROVIDER_UNAVAILABLE", matchedAdvisories: [], insufficientAdvisories: [] }],
  }));
  assert.equal(findings.filter((f) => f.code === "VULNERABILITY_PROVIDER_UNAVAILABLE").length, 1);
});

test("hardening: debug display + file editing flags; missing indicators -> insufficient only for hardening", () => {
  const findings = runSecurityRules(baseInput({
    securityIndicators: { wpDebug: "yes", wpDebugDisplay: "yes", wpDebugLog: "yes", disallowFileEdit: "no" },
  }));
  assert.ok(findings.some((f) => f.code === "WP_DEBUG_DISPLAY_ENABLED"));
  assert.ok(findings.some((f) => f.code === "DASHBOARD_FILE_EDITING_ENABLED"));
  const missing = runSecurityRules(baseInput({ securityIndicators: null, snapshotSchemaVersion: 5 }));
  assert.ok(missing.some((f) => f.code === "SECURITY_EVIDENCE_INSUFFICIENT" && /predates schema v6/.test(f.explanation)));
  assert.ok(!missing.some((f) => f.code === "WP_DEBUG_DISPLAY_ENABLED"));
});

test("headers: missing, weak, and frame-ancestors-satisfies cases", () => {
  const missing = headerFindings({ finalUrl: "https://example.com/", status: 200, headers: {}, redirectCount: 0, crossHostRedirect: false, error: null });
  assert.equal(missing.filter((f) => f.code === "SECURITY_HEADER_MISSING").length, 6);
  const weak = headerFindings({ finalUrl: "https://example.com/", status: 200, headers: { "strict-transport-security": "max-age=60", "content-security-policy": "default-src *", "x-content-type-options": "nosniff", "x-frame-options": "ALLOWALL", "referrer-policy": "no-referrer", "permissions-policy": "camera=()" }, redirectCount: 0, crossHostRedirect: false, error: null });
  assert.ok(weak.some((f) => f.code === "SECURITY_HEADER_WEAK_POLICY" && /Strict-Transport/.test(f.title)));
  assert.ok(weak.some((f) => f.code === "SECURITY_HEADER_WEAK_POLICY" && /Content-Security/.test(f.title)));
  assert.ok(weak.some((f) => f.code === "SECURITY_HEADER_WEAK_POLICY" && /X-Frame/.test(f.title)));
  // CSP frame-ancestors satisfies framing even without X-Frame-Options.
  const framed = headerFindings({ finalUrl: "https://example.com/", status: 200, headers: { "strict-transport-security": "max-age=31536000", "content-security-policy": "default-src 'self'; frame-ancestors 'self'", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "permissions-policy": "camera=()" }, redirectCount: 0, crossHostRedirect: false, error: null });
  assert.ok(!framed.some((f) => /Framing/.test(f.title)));
  const notRun = headerFindings({ finalUrl: "https://example.com/", status: null, headers: {}, redirectCount: 0, crossHostRedirect: false, error: "PROBE_FAILED" });
  assert.ok(notRun.some((f) => f.code === "SECURITY_CHECK_NOT_RUN"));
});

test("xmlrpc: responds is informational, never auto-disable; failure is not-run", () => {
  const findings = runSecurityRules(baseInput({ http: { ...baseInput().http, xmlrpc: { status: 405, responds: true, error: null } } }));
  const f = findings.find((x) => x.code === "XMLRPC_ENDPOINT_RESPONDS");
  assert.ok(f);
  assert.match(f.explanation, /NOT automatically recommended/);
  assert.equal(f.severity, "LOW");
});

test("sensitive paths: signature -> confirmed; 200 without signature -> possible; non-200 -> no finding (not proof of absence is a limitation, not a finding)", () => {
  const confirmed = classifySensitivePath("/.env", { status: 200, headers: { "content-type": "text/plain" }, bodyPreview: `DB_NAME=wp\nDB_PASSWORD=${SENTINEL}\n` });
  assert.equal(confirmed.result, "CONFIRMED");
  assert.ok(!JSON.stringify(confirmed).includes(SENTINEL), "classification must never carry the body or secret");
  const git = classifySensitivePath("/.git/HEAD", { status: 200, headers: {}, bodyPreview: "ref: refs/heads/main\n" });
  assert.equal(git.result, "CONFIRMED");
  const possible = classifySensitivePath("/.env", { status: 200, headers: { "content-type": "text/html" }, bodyPreview: "<html><body>Not found page</body></html>" });
  assert.equal(possible.result, "POSSIBLE_EXPOSURE");
  assert.equal(classifySensitivePath("/.env", { status: 404, headers: {}, bodyPreview: "" }).result, "NOT_OBSERVED");
  assert.equal(classifySensitivePath("/.env", { status: 403, headers: {}, bodyPreview: "" }).result, "NOT_OBSERVED");
  const rules = runSecurityRules(baseInput({ http: { ...baseInput().http, sensitivePaths: [confirmed, possible] } }));
  assert.ok(rules.some((f) => f.code === "SENSITIVE_FILE_EXPOSURE_CONFIRMED"));
  assert.ok(rules.some((f) => f.code === "SENSITIVE_FILE_POSSIBLE_EXPOSURE"));
  assert.ok(!JSON.stringify(rules).includes(SENTINEL));
});

test("debug log signature and config backup signature are recognised; generic 200 is not confirmed", () => {
  assert.equal(classifySensitivePath("/wp-content/debug.log", { status: 200, headers: {}, bodyPreview: "[28-Oct-2026] PHP Fatal error: foo\nStack trace:\n" }).result, "CONFIRMED");
  assert.equal(classifySensitivePath("/wp-config.php.bak", { status: 200, headers: {}, bodyPreview: "<?php\ndefine('DB_PASSWORD', 'x');\n" }).result, "CONFIRMED");
  assert.equal(classifySensitivePath("/wp-config.php.bak", { status: 200, headers: {}, bodyPreview: "<html>theme page</html>" }).result, "POSSIBLE_EXPOSURE");
});
