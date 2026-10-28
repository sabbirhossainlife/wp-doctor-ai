// Deterministic Tool 07 finding engine (pure — no I/O, no email, no
// form submission, no SMTP connection). Input: a normalized interpretation
// { snapshotStatus, contactForms, mailTransport, senderComparison,
//   emailDomain, spf, dmarc, dkim, dnsFailed }.
// Evidence status vocabulary (mirrors Tools 02–06): CONFIRMED (directly
// observed in the snapshot/DNS), POTENTIAL (observed config state that
// could cause a symptom but is not proven to), INSUFFICIENT_EVIDENCE
// (the data needed for a conclusion is absent or unknown).
// Hard invariants enforced here:
//  - absent recognised plugin ≠ no forms exist (custom/unsupported possible)
//  - unknown config ≠ failure; absent SMTP plugin ≠ failure
//  - config present ≠ delivery verified (DELIVERY_NOT_VERIFIED on every
//    COMPLETED report; SPF/DMARC presence never guarantees acceptance)
//  - no form failure is ever claimed without an authorised submission
//    test — none is performed by this tool.

function finding({ code, severity, title, explanation, evidence = {}, recommendation, confidence = "HIGH", evidenceStatus = "CONFIRMED" }) {
  return { code, severity, title, explanation, evidence, recommendation, confidence, evidenceStatus, limitations: null };
}

export function runContactEmailRules(input = {}) {
  const findings = [];
  const {
    snapshotStatus = "NOT_PROVIDED", // CURRENT | NOT_PROVIDED | OLD_SCHEMA | UNSUPPORTED
    contactForms = null,
    mailTransport = null,
    senderComparison = null,
    emailDomain = null,
    spf = null,
    dmarc = null,
    dkim = null,
    dnsFailed = false,
  } = input;

  // ---- Snapshot / evidence gate ----
  if (snapshotStatus === "NOT_PROVIDED") {
    findings.push(finding({
      code: "EMAIL_EVIDENCE_INSUFFICIENT", severity: "MEDIUM",
      title: "No WordPress snapshot was supplied for form and mail checks",
      explanation: "This run used a URL only, so no connector snapshot was available. Form-plugin and mail-transport configuration cannot be assessed from a URL alone; only the public DNS checks below were performed. Connect the site with the WP Doctor AI Connector (plugin 1.4.0 or later) and re-run with the registered website to assess forms and mail configuration.",
      evidence: { snapshotStatus },
      recommendation: "Register the website, sync a fresh diagnostic snapshot from the connector admin page, and re-run this check with the registered website selected.",
      confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
    }));
  } else if (snapshotStatus === "OLD_SCHEMA") {
    findings.push(finding({
      code: "EMAIL_EVIDENCE_INSUFFICIENT", severity: "MEDIUM",
      title: "Snapshot predates contact and email data (connector older than 1.4.0)",
      explanation: "The latest snapshot uses a schema older than v5, so it contains no contact-form or mail-transport section. That is a data-availability limit, not evidence that the site has no forms or broken mail. Update the connector plugin to version 1.4.0 or later, sync a fresh snapshot, and re-run.",
      evidence: { snapshotStatus },
      recommendation: "Update the WP Doctor AI Connector plugin to 1.4.0 or later, sync a fresh snapshot, and re-run this check.",
      confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
    }));
  }

  // ---- Form plugins ----
  if (snapshotStatus === "CURRENT" && Array.isArray(contactForms)) {
    const recognised = contactForms.filter((f) => f.pluginId !== "unknown");
    const activeRecognised = recognised.filter((f) => f.active);
    const hasUnknown = contactForms.some((f) => f.pluginId === "unknown");
    const unsupportedActive = recognised.filter((f) => f.active && f.coverage === "UNSUPPORTED");
    if (recognised.length === 0) {
      findings.push(finding({
        code: "FORM_PLUGIN_NOT_FOUND", severity: "LOW",
        title: "No recognised form plugin found in the snapshot",
        explanation: "The snapshot inventory contains no recognised contact-form plugin. This does NOT mean the site has no forms: a custom-built form, a form embedded by a theme or page builder, or an unsupported plugin may still collect submissions. Only recognised plugins with a verified adapter can be assessed.",
        evidence: { recognisedCount: 0, hasUnknownEntry: hasUnknown },
        recommendation: "If the site should have a contact form, confirm which plugin or custom integration provides it; if it uses an unsupported plugin, its notification settings must be checked manually in WordPress.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
    for (const f of recognised.filter((x) => x.installed && !x.active)) {
      findings.push(finding({
        code: "FORM_PLUGIN_INACTIVE", severity: "MEDIUM",
        title: `${f.name} is installed but inactive`,
        explanation: `The recognised form plugin ${f.name} is installed on the site but not active, so its forms (if any were published with it) are not currently served by that plugin.`,
        evidence: { pluginId: f.pluginId, version: f.version ?? null },
        recommendation: "Confirm whether this plugin should be active; if its forms are still expected to work, reactivate it on a staging copy first, then sync a fresh snapshot and re-run.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    }
    if (unsupportedActive.length > 0) {
      findings.push(finding({
        code: "FORM_CONFIGURATION_UNSUPPORTED", severity: "LOW",
        title: "An active form plugin has no verified adapter",
        explanation: `The active form plugin(s) ${unsupportedActive.map((f) => f.name).join(", ")} are recognised but have no verified adapter in this tool, so their form counts and notification settings cannot be assessed. No conclusion is drawn about whether their notifications work.`,
        evidence: { pluginIds: unsupportedActive.map((f) => f.pluginId) },
        recommendation: "Check the notification settings for these plugins manually in WordPress (form settings → notifications / email actions).",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
    for (const f of activeRecognised.filter((x) => x.coverage === "COMPLETE" || x.coverage === "PARTIAL")) {
      if (f.formsCount === 0) {
        findings.push(finding({
          code: "FORM_PLUGIN_NOT_FOUND", severity: "LOW",
          title: `${f.name} is active but has no forms`,
          explanation: `${f.name} is active, but the snapshot reports zero forms for it. A site relying on this plugin for contact submissions currently has no form to submit through it.`,
          evidence: { pluginId: f.pluginId, formsCount: 0 },
          recommendation: "Create and publish a contact form in this plugin, or confirm submissions are handled by another integration, then sync a fresh snapshot and re-run.",
          confidence: "HIGH", evidenceStatus: "CONFIRMED",
        }));
      } else if (f.mailConfigStatus === "INCOMPLETE" || f.mailConfigStatus === "PARTIAL") {
        findings.push(finding({
          code: "FORM_NOTIFICATION_CONFIG_INCOMPLETE", severity: "MEDIUM",
          title: `${f.name} notification configuration is incomplete`,
          explanation: f.mailConfigStatus === "PARTIAL"
            ? `Some (but not all) ${f.name} forms have both a sender and a recipient configured in their mail template. Forms without a complete notification template may accept submissions without notifying anyone.`
            : `No ${f.name} form has both a sender and a recipient configured in its mail template, so notifications for those forms are not fully configured. This is a configuration observation only — no submission was tested.`,
          evidence: { pluginId: f.pluginId, formsCount: f.formsCount ?? null, mailConfigStatus: f.mailConfigStatus, notificationConfigured: f.notificationConfigured ?? null },
          recommendation: "Open each form's mail/notification settings in WordPress, set a sender and a recipient, save, and sync a fresh snapshot before re-running. Do not submit a test form through this tool — it never submits forms.",
          confidence: "HIGH", evidenceStatus: "CONFIRMED",
        }));
      }
    }
    if (hasUnknown && recognised.length > 0) {
      findings.push(finding({
        code: "FORM_CONFIGURATION_UNSUPPORTED", severity: "LOW",
        title: "Custom or unknown form integration may also exist",
        explanation: "Alongside the recognised plugins, the snapshot notes an unknown or custom form integration that cannot be assessed. Its notifications, if any, were not checked.",
        evidence: {},
        recommendation: "If the site uses a custom form, check its notification handling manually in WordPress.",
        confidence: "MEDIUM", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
    void activeRecognised;
  }

  // ---- Mail transport ----
  if (snapshotStatus === "CURRENT" && Array.isArray(mailTransport)) {
    const activeMail = mailTransport.filter((m) => m.active);
    const inactiveMail = mailTransport.filter((m) => m.installed && !m.active);
    if (activeMail.length === 0 && inactiveMail.length === 0) {
      findings.push(finding({
        code: "MAIL_TRANSPORT_UNIDENTIFIED", severity: "LOW",
        title: "No recognised mail plugin is installed",
        explanation: "No recognised mail plugin (such as WP Mail SMTP) was found in the snapshot. That is NOT a failure on its own: WordPress may send mail through PHP mail or another integration not covered here. Delivery through any transport is not verified by this check.",
        evidence: {},
        recommendation: "If mail delivery matters for this site, confirm which transport WordPress uses (plugin, hosting mail service, or PHP mail) and check its settings manually; consider a recognised mail plugin only if delivery problems are reported.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
    for (const m of inactiveMail) {
      findings.push(finding({
        code: "MAIL_TRANSPORT_UNIDENTIFIED", severity: "LOW",
        title: `${m.name} is installed but inactive`,
        explanation: `${m.name} is installed but not active, so it is not currently handling the site's mail. Another transport (or PHP mail) may be in use instead; this check does not identify it.`,
        evidence: { pluginId: m.pluginId },
        recommendation: "Confirm which mail transport should be active; if this plugin should handle mail, reactivate it on a staging copy first, then sync a fresh snapshot and re-run.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    }
    for (const m of activeMail.filter((x) => x.coverage === "UNSUPPORTED")) {
      findings.push(finding({
        code: "FORM_CONFIGURATION_UNSUPPORTED", severity: "LOW",
        title: `${m.name} has no verified adapter`,
        explanation: `${m.name} is active but has no verified adapter in this tool, so its mail configuration cannot be assessed. No conclusion is drawn about whether its settings are complete.`,
        evidence: { pluginId: m.pluginId },
        recommendation: "Check this plugin's mail settings manually in WordPress.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
    for (const m of activeMail.filter((x) => x.coverage === "COMPLETE" || x.coverage === "PARTIAL")) {
      if (m.requiredFieldsComplete === "no" || m.senderConfigured === "no") {
        findings.push(finding({
          code: "MAIL_TRANSPORT_CONFIG_INCOMPLETE", severity: "MEDIUM",
          title: `${m.name} mail configuration appears incomplete`,
          explanation: `${m.name} is active, but the snapshot indicates required configuration is incomplete (sender address or required mailer fields missing). Mail sent through this transport may fail or be sent from an unexpected address. Credentials were never read or checked — only the presence of required non-secret fields was assessed.`,
          evidence: { pluginId: m.pluginId, mailer: m.mailer ?? null, requiredFieldsComplete: m.requiredFieldsComplete ?? null, senderConfigured: m.senderConfigured ?? null },
          recommendation: "Complete the mail settings for this plugin in WordPress (sender address and mailer settings), save, and sync a fresh snapshot before re-running. Never paste credentials into this tool.",
          confidence: "HIGH", evidenceStatus: "CONFIRMED",
        }));
      }
    }
  }

  // ---- Sender-domain comparison (server-side, domain-only) ----
  if (senderComparison && senderComparison.comparisonEstablished === true) {
    if (senderComparison.domainMatches === false) {
      findings.push(finding({
        code: "SENDER_DOMAIN_MISMATCH", severity: "MEDIUM",
        title: "Sender domain does not match the checked email domain",
        explanation: `The configured sender domain (${senderComparison.senderDomain}) differs from the email domain being checked (${emailDomain}). Mail sent from a domain that does not match the domain's SPF/DMARC alignment may be rejected or marked as spam by receiving providers. This is a configuration mismatch observation, not proof that any specific message failed.`,
        evidence: { senderDomain: senderComparison.senderDomain, emailDomain },
        recommendation: "Align the sender address with the checked domain (or check the domain that actually sends the mail) and confirm SPF/DMARC for that domain.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    }
  }

  // ---- DNS: SPF ----
  if (spf) {
    if (spf.status === "PRESENT") {
      findings.push(finding({
        code: "SPF_RECORD_PRESENT", severity: "LOW",
        title: "SPF record found",
        explanation: `A single SPF record was found for ${emailDomain}. Presence alone does not guarantee that receiving providers will accept mail, and this check does not evaluate lookup limits or include chains.`,
        evidence: { emailDomain, recordCount: spf.recordCount ?? null },
        recommendation: "No SPF action is needed on presence alone. If delivery problems are reported, review the record's mechanisms manually.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (spf.status === "MISSING") {
      findings.push(finding({
        code: "SPF_RECORD_MISSING", severity: "MEDIUM",
        title: "No SPF record found",
        explanation: `No TXT record starting with "v=spf1" was found for ${emailDomain}. Without an SPF record, receiving providers cannot verify that the sending server is authorised for this domain, which increases the chance of rejection or spam-folder delivery. This is a DNS observation, not proof that any specific message failed.`,
        evidence: { emailDomain, recordCount: spf.recordCount ?? null },
        recommendation: "Add an SPF TXT record for the domain that authorises the actual sending servers, then re-run this check. Do not copy another site's record — authorise only servers that really send for this domain.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (spf.status === "SYNTAX_WARNING") {
      if (spf.anomalies?.includes("multiple-spf-records")) {
        findings.push(finding({
          code: "SPF_MULTIPLE_RECORDS", severity: "MEDIUM",
          title: "Multiple SPF records found",
          explanation: `More than one TXT record starting with "v=spf1" was found for ${emailDomain}. Receiving providers typically use only one SPF record, so multiple records can cause SPF evaluation to fail even though each record looks valid on its own.`,
          evidence: { emailDomain, anomalies: spf.anomalies },
          recommendation: "Merge the SPF mechanisms into a single " + '"v=spf1"' + " record and remove the extras, then re-run this check.",
          confidence: "HIGH", evidenceStatus: "CONFIRMED",
        }));
      } else {
        findings.push(finding({
          code: "SPF_SYNTAX_WARNING", severity: "MEDIUM",
          title: "SPF record has a detectable syntax anomaly",
          explanation: `The SPF evidence for ${emailDomain} contains a reliably detectable anomaly (${(spf.anomalies ?? []).join(", ")}). This check does not claim full standards compliance — only the listed anomalies are checked.`,
          evidence: { emailDomain, anomalies: spf.anomalies ?? [] },
          recommendation: "Review the domain's TXT records manually, correct the anomaly, and re-run this check.",
          confidence: "MEDIUM", evidenceStatus: "POTENTIAL",
        }));
      }
    } else if (spf.status === "LOOKUP_FAILED") {
      findings.push(finding({
        code: "EMAIL_DNS_LOOKUP_FAILED", severity: "MEDIUM",
        title: "SPF DNS lookup failed",
        explanation: `The DNS lookup for ${emailDomain} TXT records failed or timed out. No SPF conclusion is drawn from a failed lookup; other findings in this report are unaffected.`,
        evidence: { emailDomain, check: "spf" },
        recommendation: "Check that the domain resolves publicly, then re-run this check.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    } else if (spf.status === "NOT_CHECKED") {
      findings.push(finding({
        code: "EMAIL_EVIDENCE_INSUFFICIENT", severity: "MEDIUM",
        title: "SPF could not be checked: no valid email domain",
        explanation: "No valid email domain was supplied or derivable, so the SPF check was not performed. This is a missing-input limit, not a DNS result.",
        evidence: {},
        recommendation: "Supply a valid email domain (for example the domain the site sends mail from) and re-run.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
  }

  // ---- DNS: DMARC ----
  if (dmarc) {
    if (dmarc.status === "PRESENT" && dmarc.policy === "none") {
      findings.push(finding({
        code: "DMARC_POLICY_MONITORING", severity: "LOW",
        title: "DMARC policy is monitoring only (p=none)",
        explanation: `A DMARC record was found for ${emailDomain} with policy p=none. Monitoring mode is valid and is not a syntax error: it tells receiving providers to report DMARC results without quarantining or rejecting failing mail. It does not enforce authentication, so unauthenticated mail is not blocked by DMARC. This tool never recommends a policy change automatically — changing p=none to quarantine or reject is a deliberate deliverability decision.`,
        evidence: { emailDomain, policy: "none" },
        recommendation: "No action is required for monitoring mode itself. Only move to quarantine or reject after reviewing DMARC reports and confirming legitimate senders pass SPF/DKIM alignment.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (dmarc.status === "PRESENT") {
      findings.push(finding({
        code: "DMARC_RECORD_PRESENT", severity: "LOW",
        title: `DMARC record found (policy p=${dmarc.policy})`,
        explanation: `A single parseable DMARC record was found for ${emailDomain} with enforcement policy p=${dmarc.policy}. Presence alone does not guarantee acceptance, and this check does not evaluate alignment of individual messages.`,
        evidence: { emailDomain, policy: dmarc.policy },
        recommendation: "No DMARC action is needed on presence alone.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (dmarc.status === "MISSING") {
      findings.push(finding({
        code: "DMARC_RECORD_MISSING", severity: "MEDIUM",
        title: "No DMARC record found",
        explanation: `No TXT record starting with "v=DMARC1" was found at _dmarc.${emailDomain}. Without DMARC, receiving providers have no published policy for handling mail that fails SPF/DKIM alignment for this domain.`,
        evidence: { emailDomain },
        recommendation: "Consider publishing a DMARC record starting in monitoring mode (p=none) with a reporting address, then review reports before any enforcement policy.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (dmarc.status === "MULTIPLE") {
      findings.push(finding({
        code: "DMARC_RECORD_INVALID", severity: "MEDIUM",
        title: "Multiple conflicting DMARC records found",
        explanation: `More than one TXT record starting with "v=DMARC1" was found at _dmarc.${emailDomain}. Multiple DMARC records conflict, so receiving providers may ignore DMARC for this domain.`,
        evidence: { emailDomain, anomalies: dmarc.anomalies ?? [] },
        recommendation: "Keep a single DMARC record for the domain and remove the extras, then re-run this check.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (dmarc.status === "INVALID") {
      findings.push(finding({
        code: "DMARC_RECORD_INVALID", severity: "MEDIUM",
        title: "DMARC record is malformed",
        explanation: `A record starting with "v=DMARC1" was found at _dmarc.${emailDomain}, but it has no recognised enforcement policy (p=none, p=quarantine, or p=reject). A DMARC record without a valid p= tag cannot be applied by receiving providers.`,
        evidence: { emailDomain, policy: dmarc.policy ?? null },
        recommendation: "Correct the DMARC record so it includes a valid p= tag, then re-run this check.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (dmarc.status === "LOOKUP_FAILED") {
      findings.push(finding({
        code: "EMAIL_DNS_LOOKUP_FAILED", severity: "MEDIUM",
        title: "DMARC DNS lookup failed",
        explanation: `The DNS lookup for _dmarc.${emailDomain} failed or timed out. No DMARC conclusion is drawn from a failed lookup; other findings in this report are unaffected.`,
        evidence: { emailDomain, check: "dmarc" },
        recommendation: "Check that the domain resolves publicly, then re-run this check.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    } else if (dmarc.status === "NOT_CHECKED") {
      findings.push(finding({
        code: "EMAIL_EVIDENCE_INSUFFICIENT", severity: "MEDIUM",
        title: "DMARC could not be checked: no valid email domain",
        explanation: "No valid email domain was supplied or derivable, so the DMARC check was not performed.",
        evidence: {},
        recommendation: "Supply a valid email domain and re-run.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
  }

  // ---- DNS: DKIM ----
  if (dkim) {
    if (dkim.status === "NOT_CHECKED") {
      findings.push(finding({
        code: "DKIM_SELECTOR_UNKNOWN", severity: "LOW",
        title: "DKIM was not checked: no selector available",
        explanation: dkim.reason === "SELECTOR_INVALID"
          ? "The supplied DKIM selector was not DNS-label-safe, so no DKIM query was made. No DKIM conclusion is drawn."
          : "No DKIM selector was supplied and none could be reliably obtained from supported non-secret configuration, so no DKIM query was made. Selectors are never guessed, and DKIM is never declared missing from an unknown selector.",
        evidence: {},
        recommendation: "If DKIM should be checked, supply the selector your mail provider gave you (found in the provider's DNS setup instructions) and re-run.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    } else if (dkim.status === "PRESENT") {
      findings.push(finding({
        code: "DKIM_RECORD_PRESENT", severity: "LOW",
        title: "DKIM record found for the supplied selector",
        explanation: `A TXT record was found at ${dkim.selector}._domainkey.${emailDomain}. Record presence alone is not a signature or delivery test: it does not prove that outgoing mail is actually DKIM-signed with this selector.`,
        evidence: { emailDomain, selector: dkim.selector },
        recommendation: "No DKIM action is needed on presence alone. If delivery problems are reported, verify signing in the mail provider's own tools.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (dkim.status === "NOT_FOUND") {
      findings.push(finding({
        code: "DKIM_RECORD_NOT_FOUND", severity: "MEDIUM",
        title: "No DKIM record found for the supplied selector",
        explanation: `No TXT record was found at ${dkim.selector}._domainkey.${emailDomain}. This means only that this exact selector has no published key: a different selector may exist, and this result alone does not prove mail is unsigned.`,
        evidence: { emailDomain, selector: dkim.selector },
        recommendation: "Confirm the selector with the mail provider, check for typos, allow time for DNS propagation, and re-run. Do not publish a key you did not obtain from the provider.",
        confidence: "HIGH", evidenceStatus: "CONFIRMED",
      }));
    } else if (dkim.status === "LOOKUP_FAILED") {
      findings.push(finding({
        code: "EMAIL_DNS_LOOKUP_FAILED", severity: "MEDIUM",
        title: "DKIM DNS lookup failed",
        explanation: `The DNS lookup for ${dkim.selector}._domainkey.${emailDomain} failed or timed out. No DKIM conclusion is drawn from a failed lookup.`,
        evidence: { emailDomain, selector: dkim.selector, check: "dkim" },
        recommendation: "Check that the domain resolves publicly, then re-run this check.",
        confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
      }));
    }
  }

  if (dnsFailed && !findings.some((f) => f.code === "EMAIL_DNS_LOOKUP_FAILED")) {
    findings.push(finding({
      code: "EMAIL_DNS_LOOKUP_FAILED", severity: "MEDIUM",
      title: "A DNS lookup failed",
      explanation: "At least one DNS lookup failed or timed out. Findings from the lookups that succeeded are preserved; no conclusion is drawn from the failed lookup.",
      evidence: {},
      recommendation: "Re-run this check; if the failure persists, check public DNS resolution for the domain.",
      confidence: "HIGH", evidenceStatus: "INSUFFICIENT_EVIDENCE",
    }));
  }

  return findings;
}

// Appends the standing delivery caveat to a COMPLETED report. Delivery is
// never verified by a read-only check: no email was sent, no form was
// submitted, no SMTP connection was opened.
export function deliveryNotVerifiedFinding() {
  return finding({
    code: "DELIVERY_NOT_VERIFIED", severity: "LOW",
    title: "Email delivery was not verified",
    explanation: "This is a read-only configuration and DNS check. It never sent an email, submitted a form, or connected to a mail server, so it cannot verify that any message actually arrives in an inbox. A complete configuration and present SPF/DMARC records still do not guarantee acceptance by receiving providers.",
    evidence: {},
    recommendation: "If delivery problems are reported, use the mail provider's own logs and test tools (outside this app) to verify actual delivery.",
    confidence: "HIGH", evidenceStatus: "CONFIRMED",
  });
}
