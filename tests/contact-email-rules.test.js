// Tool 07 unit tests: domain validation, DNS fixture analysis, rules.
// No live DNS, no email send, no form submission anywhere in this file.
import test from "node:test";
import assert from "node:assert/strict";
import { isPublicDomain, defaultEmailDomainFromUrl, isValidDkimSelector, domainFromEmail } from "../lib/contact-email/domain.js";
import { analyzeSpf, analyzeDmarc, runEmailDnsChecks } from "../lib/contact-email/dns.js";
import { runContactEmailRules, deliveryNotVerifiedFinding } from "../lib/contact-email/rules.js";

test("domain: valid multi-label domains pass; IPs, localhost, single-label rejected", () => {
  assert.equal(isPublicDomain("example.com"), true);
  assert.equal(isPublicDomain("sub.example.co.uk"), true);
  assert.equal(isPublicDomain("192.168.1.1"), false);
  assert.equal(isPublicDomain("localhost"), false);
  assert.equal(isPublicDomain("example"), false);
  assert.equal(isPublicDomain("example.c"), false);
  assert.equal(isPublicDomain("exa mple.com"), false);
  assert.equal(isPublicDomain(""), false);
});

test("domain: default rule strips one www. only, rejects IP/localhost hosts", () => {
  assert.equal(defaultEmailDomainFromUrl("https://www.example.com/page"), "example.com");
  assert.equal(defaultEmailDomainFromUrl("https://example.com/"), "example.com");
  assert.equal(defaultEmailDomainFromUrl("https://www.www.example.com/"), "www.example.com");
  assert.equal(defaultEmailDomainFromUrl("http://127.0.0.1:8080/"), null);
  assert.equal(defaultEmailDomainFromUrl("https://localhost/"), null);
  assert.equal(defaultEmailDomainFromUrl("not a url"), null);
});

test("domain: dkim selectors and literal-email domains", () => {
  assert.equal(isValidDkimSelector("google"), true);
  assert.equal(isValidDkimSelector("selector_1-x"), true);
  assert.equal(isValidDkimSelector("bad selector!"), false);
  assert.equal(isValidDkimSelector(""), false);
  assert.equal(domainFromEmail("hello@example.com"), "example.com");
  assert.equal(domainFromEmail("[your-email]"), null);
  assert.equal(domainFromEmail("admin@192.168.0.1"), null);
});

test("spf: one valid, missing, multiple, empty record, spf-like without tag", () => {
  assert.equal(analyzeSpf(["v=spf1 include:_spf.example.com ~all"]).status, "PRESENT");
  assert.equal(analyzeSpf(["hello world"]).status, "MISSING");
  const multi = analyzeSpf(["v=spf1 a", "v=spf1 mx"]);
  assert.equal(multi.status, "SYNTAX_WARNING");
  assert.ok(multi.anomalies.includes("multiple-spf-records"));
  const empty = analyzeSpf(["", "v=spf1 a"]);
  assert.equal(empty.status, "SYNTAX_WARNING");
  assert.ok(empty.anomalies.includes("empty-txt-record"));
  const like = analyzeSpf(["include:_spf.example.com ~all"]);
  assert.equal(like.status, "MISSING"); // no v=spf1 record at all -> MISSING, but anomaly recorded? see below
  assert.ok(like.anomalies.includes("spf-like-record-without-version-tag"));
  const warned = analyzeSpf(["v=spf1 a", "include:other.example ~all"]);
  assert.equal(warned.status, "SYNTAX_WARNING");
});

test("dmarc: p=none is monitoring (not invalid), missing, multiple, malformed", () => {
  const monitoring = analyzeDmarc(["v=DMARC1; p=none; rua=mailto:dmarc@example.com"]);
  assert.equal(monitoring.status, "PRESENT");
  assert.equal(monitoring.policy, "none");
  assert.equal(analyzeDmarc(["hello"]).status, "MISSING");
  assert.equal(analyzeDmarc(["v=DMARC1; p=reject", "v=DMARC1; p=none"]).status, "MULTIPLE");
  assert.equal(analyzeDmarc(["v=DMARC1; rua=mailto:x@example.com"]).status, "INVALID");
  const enforced = analyzeDmarc(["v=DMARC1; p=reject"]);
  assert.equal(enforced.policy, "reject");
});

test("dns: injected resolver fixtures — timeout/failure degrades one check only", async () => {
  const fixture = async (host) => {
    if (host === "example.com") return [["v=spf1 include:_spf.example.com ~all"]];
    if (host === "_dmarc.example.com") return [["v=DMARC1; p=none"]];
    if (host === "google._domainkey.example.com") return [["v=DKIM1; k=rsa; p=MIGfMA0"]];
    throw Object.assign(new Error("NXDOMAIN"), { code: "ENOTFOUND" });
  };
  const out = await runEmailDnsChecks("example.com", "google", { resolver: fixture });
  assert.equal(out.spf.status, "PRESENT");
  assert.equal(out.dmarc.policy, "none");
  assert.equal(out.dkim.status, "PRESENT");
  assert.equal(out.dnsFailed, false);

  const failing = async (host) => {
    if (host === "example.com") throw new Error("timeout");
    if (host === "_dmarc.example.com") return [["v=DMARC1; p=reject"]];
    throw new Error("nope");
  };
  const out2 = await runEmailDnsChecks("example.com", null, { resolver: failing });
  assert.equal(out2.spf.status, "LOOKUP_FAILED");
  assert.equal(out2.dmarc.status, "PRESENT");
  assert.equal(out2.dkim.status, "NOT_CHECKED");
  assert.equal(out2.dnsFailed, true);

  const invalid = await runEmailDnsChecks("not-a-domain", null, { resolver: fixture });
  assert.equal(invalid.spf.status, "NOT_CHECKED");
  assert.equal(invalid.dnsFailed, false);
});

test("dns: TXT output bounded — record count and excerpt caps", async () => {
  const big = "x".repeat(5000);
  const resolver = async () => Array.from({ length: 200 }, () => [big]);
  const out = await runEmailDnsChecks("example.com", "sel", { resolver });
  assert.ok(out.spf.excerpt.every((s) => s.length <= 512));
  assert.ok(out.spf.recordCount <= 50);
});

test("rules: CF7 inactive, incomplete notification, unsupported plugin, mismatch", () => {
  const codes = runContactEmailRules({
    snapshotStatus: "CURRENT",
    contactForms: [
      { pluginId: "contact-form-7", name: "Contact Form 7", installed: true, active: false, version: "6.2.3", coverage: "COMPLETE", formsCount: null, notificationConfigured: null, mailConfigStatus: null },
      { pluginId: "wpforms", name: "WPForms", installed: true, active: true, version: "1.9.0", coverage: "UNSUPPORTED", formsCount: null, notificationConfigured: null, mailConfigStatus: null },
    ],
    mailTransport: [],
    senderComparison: null,
    emailDomain: "example.com",
    spf: { status: "MISSING" },
    dmarc: { status: "MISSING" },
    dkim: { status: "NOT_CHECKED", reason: "SELECTOR_UNKNOWN" },
    dnsFailed: false,
  }).map((f) => f.code);
  assert.ok(codes.includes("FORM_PLUGIN_INACTIVE"));
  assert.ok(codes.includes("FORM_CONFIGURATION_UNSUPPORTED"));
  assert.ok(codes.includes("MAIL_TRANSPORT_UNIDENTIFIED"));
  assert.ok(codes.includes("SPF_RECORD_MISSING"));
  assert.ok(codes.includes("DMARC_RECORD_MISSING"));
  assert.ok(codes.includes("DKIM_SELECTOR_UNKNOWN"));
  assert.ok(!codes.includes("DELIVERY_NOT_VERIFIED"), "service appends delivery caveat, not the pure rule engine");
});

test("rules: notification incomplete + sender mismatch + monitoring are distinct", () => {
  const findings = runContactEmailRules({
    snapshotStatus: "CURRENT",
    contactForms: [
      { pluginId: "contact-form-7", name: "Contact Form 7", installed: true, active: true, version: "6.2.3", coverage: "COMPLETE", formsCount: 2, notificationConfigured: "no", mailConfigStatus: "INCOMPLETE" },
    ],
    mailTransport: [
      { pluginId: "wp-mail-smtp", name: "WP Mail SMTP", installed: true, active: true, version: "4.0.0", coverage: "PARTIAL", configPresent: "yes", requiredFieldsComplete: "yes", mailer: "smtp", senderConfigured: "yes", senderDomain: "other.com" },
    ],
    senderComparison: { senderConfigured: "yes", senderDomain: "other.com", domainMatches: false, comparisonEstablished: true },
    emailDomain: "example.com",
    spf: { status: "PRESENT" },
    dmarc: { status: "PRESENT", policy: "none" },
    dkim: { status: "NOT_FOUND", selector: "google" },
    dnsFailed: false,
  });
  const codes = findings.map((f) => f.code);
  assert.ok(codes.includes("FORM_NOTIFICATION_CONFIG_INCOMPLETE"));
  assert.ok(codes.includes("SENDER_DOMAIN_MISMATCH"));
  assert.ok(codes.includes("DMARC_POLICY_MONITORING"));
  assert.ok(codes.includes("DKIM_RECORD_NOT_FOUND"));
  assert.ok(codes.includes("SPF_RECORD_PRESENT"));
  const monitoring = findings.find((f) => f.code === "DMARC_POLICY_MONITORING");
  assert.equal(monitoring.severity, "LOW");
  assert.match(monitoring.explanation, /not a syntax error/);
});

test("rules: no recognised plugin never claims no forms exist", () => {
  const findings = runContactEmailRules({
    snapshotStatus: "CURRENT",
    contactForms: [{ pluginId: "unknown", name: "Unknown or custom form integration", installed: false, active: false, version: null, coverage: "UNSUPPORTED", formsCount: null, notificationConfigured: null, mailConfigStatus: null }],
    mailTransport: [],
    senderComparison: null,
    emailDomain: "example.com",
    spf: { status: "PRESENT" },
    dmarc: { status: "PRESENT", policy: "reject" },
    dkim: { status: "NOT_CHECKED", reason: "SELECTOR_UNKNOWN" },
    dnsFailed: false,
  });
  const notFound = findings.find((f) => f.code === "FORM_PLUGIN_NOT_FOUND");
  assert.ok(notFound);
  assert.match(notFound.explanation, /does NOT mean the site has no forms/);
  assert.equal(notFound.evidenceStatus, "INSUFFICIENT_EVIDENCE");
});

test("rules: old schema and URL-only yield insufficient evidence, never plugin-broken claims", () => {
  for (const status of ["OLD_SCHEMA", "NOT_PROVIDED"]) {
    const findings = runContactEmailRules({ snapshotStatus: status, contactForms: null, mailTransport: null, senderComparison: null, emailDomain: null, spf: { status: "NOT_CHECKED" }, dmarc: { status: "NOT_CHECKED" }, dkim: { status: "NOT_CHECKED" }, dnsFailed: false });
    const text = JSON.stringify(findings);
    assert.ok(!/broken|misconfigured plugin/i.test(text) || /not evidence/.test(text));
    assert.ok(findings.some((f) => f.code === "EMAIL_EVIDENCE_INSUFFICIENT"));
  }
});

test("rules: delivery caveat states no send/submit/verification", () => {
  const f = deliveryNotVerifiedFinding();
  assert.equal(f.code, "DELIVERY_NOT_VERIFIED");
  assert.match(f.explanation, /never sent an email/);
  assert.match(f.explanation, /submitted a form/);
});

test("rules: no send/submit/mail path exists in the diagnostic modules", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const file of ["domain.js", "dns.js", "rules.js", "freshness.js", "rate-limit.js", "service.js"]) {
    const src = readFileSync(path.join(root, "lib/contact-email", file), "utf8");
    assert.ok(!src.includes("nodemailer"), `${file} must not use nodemailer`);
    assert.ok(!src.includes("createTransport"), `${file} must not create an SMTP transport`);
  }
});
