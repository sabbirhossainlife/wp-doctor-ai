// Strict diagnostic-snapshot schema (server-side only). Milestone 6 adds
// schemaVersion 2 alongside v1 (backward-compatible: old plugin payloads
// still validate). Allowlist: exactly the fields the plugin may send.
// Anything else — unknown fields, prohibited data, wrong types, oversized
// values — rejects the whole payload. This function never logs the payload.
//
// v1: wordpressVersion, phpVersion, homeUrl, siteUrl, pluginVersion,
//     activePlugins[{name, version}], activeTheme[{name, version}],
//     multisite, locale.
// v2 adds: plugins[] (ALL installed plugins, each {name, slug, version,
//     active, networkActive, muPlugin, requiresWP, requiresPHP,
//     dependencies[], updateAvailable, newVersion, updateCheckedAt})
//     and theme {name, version, parentName, parentVersion, requiresWP,
//     requiresPHP}. The v1 activePlugins/activeTheme fields are kept in v2
//     so old consumers keep working; the conflict engine reads plugins/theme.
// The `slug` field is required for Rule C: declared dependencies are slugs
// (WP 6.5+ "Requires Plugins" header), and display names cannot be matched
// to slugs. Slugs are derived from plugin file paths, never from user input.
const MAX_PLUGINS = 200;
const MAX_STR = 500;

function isBoundedString(value, max = MAX_STR) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isOptionalBoundedString(value, max = MAX_STR) {
  return value === null || value === undefined || (typeof value === "string" && value.length <= max);
}

function isOptionalVersion(value) {
  return value === null || value === undefined || (typeof value === "string" && value.length <= 50);
}

const V1_KEYS = new Set([
  "schemaVersion",
  "wordpressVersion",
  "phpVersion",
  "homeUrl",
  "siteUrl",
  "pluginVersion",
  "activePlugins",
  "activeTheme",
  "multisite",
  "locale",
]);

const V2_KEYS = new Set([...V1_KEYS, "plugins", "theme"]);
// Milestone 7 (schema v3): v2 fields PLUS `woocommerce` (see validateWooCommerce
// below). v1 and v2 payloads keep validating exactly as before; a v1/v2
// snapshot simply has no WooCommerce data, which Tool 03 treats as UNKNOWN,
// never as "WooCommerce disabled".
const V3_KEYS = new Set([...V2_KEYS, "woocommerce"]);
// Milestone 8 (schema v4): v3 fields PLUS `elementor` and `environment`
// (see validateElementor / validateEnvironment below). v1-v3 payloads keep
// validating exactly as before; a v1-v3 snapshot simply has no Elementor
// data, which Tool 04 treats as UNKNOWN, never as "Elementor missing".
const V4_KEYS = new Set([...V3_KEYS, "elementor", "environment"]);
// Milestone 11 (schema v5): v4 fields PLUS `contactForms`, `mailTransport`
// and `senderDomain` (see validateContactEmail below). v1-v4 payloads keep
// validating exactly as before; a v1-v4 snapshot simply has no contact/email
// data, which Tool 07 treats as INSUFFICIENT_EVIDENCE, never as "plugin
// broken", "no forms exist", or "mail misconfigured".
const V5_KEYS = new Set([...V4_KEYS, "contactForms", "mailTransport", "senderDomain"]);
// Milestone 12 (schema v6): v5 fields PLUS `securityIndicators` (see
// validateSecurityIndicators below). v1-v5 payloads keep validating
// exactly as before; a v1-v5 snapshot simply has no hardening flags,
// which Tool 08 treats as INSUFFICIENT_EVIDENCE for hardening checks
// only, never as a secure configuration.
const V6_KEYS = new Set([...V5_KEYS, "securityIndicators"]);
// Milestone 13 (schema v7): v6 fields PLUS optional `malwareScan` (see
// validateMalwareScan below) and an optional theme `slug` (stylesheet
// directory name from the theme API — a trusted runtime source, never a
// display-name match). v1-v6 payloads keep validating exactly as before;
// a v1-v6 snapshot simply has no malware evidence, which Tool 09 reports
// as MALWARE_CHECK_NOT_RUN, never as "no malware". A v7 snapshot without
// malwareScan is still valid: the field is optional by design, so a
// missing optional malware field never invalidates otherwise usable data.
const V7_KEYS = new Set([...V6_KEYS, "malwareScan"]);
// Literal (not [...THEME_KEYS]) because THEME_KEYS is declared below this
// point; the two sets must stay in sync (see the v7 theme branch).
const V7_THEME_KEYS = new Set(["name", "version", "parentName", "parentVersion", "requiresWP", "requiresPHP", "slug"]);
const SECURITY_INDICATOR_KEYS = new Set(["wpDebug", "wpDebugDisplay", "wpDebugLog", "disallowFileEdit"]);
const CONTACT_COVERAGE = new Set(["COMPLETE", "PARTIAL", "UNSUPPORTED"]);
const TRI_STATE = new Set(["yes", "no", "unknown"]);
const MAIL_CONFIG_STATUS = new Set(["CONFIGURED", "PARTIAL", "INCOMPLETE", "UNKNOWN", "NO_FORMS"]);
const MAILER_IDS = new Set(["mail", "smtp", "sendgrid", "mailgun", "ses", "postmark", "sendinblue", "sparkpost", "zoho", "gmail", "outlook", "other", "unknown"]);
const ELEMENTOR_KEYS = new Set(["installed", "active", "version", "pro", "status"]);
const ELEMENTOR_PRO_KEYS = new Set(["installed", "active", "version"]);
const ELEMENTOR_STATUS = new Set(["AVAILABLE", "NOT_INSTALLED", "INACTIVE", "UNKNOWN"]);
const ENVIRONMENT_KEYS = new Set(["phpMemoryLimit", "wpMemoryLimit", "maxExecutionTime"]);
const WOO_KEYS = new Set(["installed", "active", "version", "status", "pages", "gateways"]);
const WOO_STATUS = new Set(["AVAILABLE", "NOT_INSTALLED", "INACTIVE", "UNKNOWN"]);
const WOO_PAGE_KEYS = new Set(["pageId", "exists", "status", "implementation"]);
const WOO_PAGE_STATUS = new Set(["publish", "draft", "trash", "private", "unknown"]);
const WOO_PAGE_IMPL = new Set(["block", "classic-shortcode", "unknown"]);
const WOO_GATEWAY_KEYS = new Set(["id", "title", "enabled", "available", "blockCompatibility", "blockCompatibilitySource"]);
const WOO_BLOCK_COMPAT = new Set(["SUPPORTED", "UNSUPPORTED", "UNKNOWN"]);
const WOO_BLOCK_SOURCE = new Set(["not-determined", "declared"]);
const MAX_GATEWAYS = 100;
const PLUGIN_KEYS = new Set([
  "name", "slug", "version", "active", "networkActive", "muPlugin",
  "requiresWP", "requiresPHP", "dependencies", "updateAvailable",
  "newVersion", "updateCheckedAt",
]);
const THEME_KEYS = new Set(["name", "version", "parentName", "parentVersion", "requiresWP", "requiresPHP"]);

function invalid() {
  return { ok: false, error: "INVALID_DIAGNOSTIC_PAYLOAD" };
}

function validateActivePlugins(value) {
  if (!Array.isArray(value) || value.length > MAX_PLUGINS) return null;
  const out = [];
  for (const plugin of value) {
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) return null;
    const keys = Object.keys(plugin);
    if (keys.length !== 2 || !keys.includes("name") || !keys.includes("version")) return null;
    if (!isBoundedString(plugin.name, 200) || !isOptionalBoundedString(plugin.version, 50)) return null;
    out.push({ name: plugin.name, version: plugin.version ?? null });
  }
  return out;
}

function validateActiveTheme(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("name") || !keys.includes("version")) return undefined;
  if (!isBoundedString(value.name, 200) || !isOptionalBoundedString(value.version, 50)) return undefined;
  return { name: value.name, version: value.version ?? null };
}

// Returns { ok: true, snapshot } or { ok: false, error }.
// The returned snapshot is a fresh minimized object (unknown fields
// are never carried through, even if validation passed).
// Validates the Milestone 7 `woocommerce` object. Returns a minimized copy
// or null. Deliberately narrow: only id/title/enabled/availability-indicator
// (null when not safely determinable)/block-compatibility may travel. No
// gateway settings, secrets, keys, orders, customers, or config of any kind.
function validateWooCommerce(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of Object.keys(value)) if (!WOO_KEYS.has(key)) return null;
  if (typeof value.installed !== "boolean" || typeof value.active !== "boolean") return null;
  if (!isOptionalVersion(value.version)) return null;
  if (!WOO_STATUS.has(value.status)) return null;
  if (!value.pages || typeof value.pages !== "object" || Array.isArray(value.pages)) return null;
  const pageRoles = ["cart", "checkout", "myAccount"];
  if (Object.keys(value.pages).some((k) => !pageRoles.includes(k))) return null;
  const pages = {};
  for (const role of pageRoles) {
    const page = value.pages[role];
    if (page === null || page === undefined) { pages[role] = null; continue; }
    if (typeof page !== "object" || Array.isArray(page)) return null;
    for (const key of Object.keys(page)) if (!WOO_PAGE_KEYS.has(key)) return null;
    if (page.pageId !== null && (!Number.isInteger(page.pageId) || page.pageId <= 0)) return null;
    if (typeof page.exists !== "boolean") return null;
    if (!WOO_PAGE_STATUS.has(page.status) || !WOO_PAGE_IMPL.has(page.implementation)) return null;
    pages[role] = { pageId: page.pageId ?? null, exists: page.exists, status: page.status, implementation: page.implementation };
  }
  if (!Array.isArray(value.gateways) || value.gateways.length > MAX_GATEWAYS) return null;
  const gateways = [];
  for (const g of value.gateways) {
    if (!g || typeof g !== "object" || Array.isArray(g)) return null;
    for (const key of Object.keys(g)) if (!WOO_GATEWAY_KEYS.has(key)) return null;
    if (!isBoundedString(g.id, 200) || !isBoundedString(g.title, 500)) return null;
    if (typeof g.enabled !== "boolean") return null;
    if (g.available !== null && typeof g.available !== "boolean") return null;
    if (!WOO_BLOCK_COMPAT.has(g.blockCompatibility) || !WOO_BLOCK_SOURCE.has(g.blockCompatibilitySource)) return null;
    gateways.push({
      id: g.id, title: g.title, enabled: g.enabled, available: g.available,
      blockCompatibility: g.blockCompatibility, blockCompatibilitySource: g.blockCompatibilitySource,
    });
  }
  return {
    installed: value.installed, active: value.active, version: value.version ?? null,
    status: value.status, pages, gateways,
  };
}

function validateElementor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of Object.keys(value)) if (!ELEMENTOR_KEYS.has(key)) return null;
  if (typeof value.installed !== "boolean" || typeof value.active !== "boolean") return null;
  if (!isOptionalVersion(value.version)) return null;
  if (!ELEMENTOR_STATUS.has(value.status)) return null;
  const pro = value.pro;
  if (!pro || typeof pro !== "object" || Array.isArray(pro)) return null;
  for (const key of Object.keys(pro)) if (!ELEMENTOR_PRO_KEYS.has(key)) return null;
  if (typeof pro.installed !== "boolean" || typeof pro.active !== "boolean") return null;
  if (!isOptionalVersion(pro.version)) return null;
  return {
    installed: value.installed, active: value.active, version: value.version ?? null,
    pro: { installed: pro.installed, active: pro.active, version: pro.version ?? null },
    status: value.status,
  };
}

// Milestone 11 (schema v5) — contact forms + mail transport. Deliberately
// narrow: tri-state booleans, counts, coverage labels, controlled status
// codes, and domain-only sender data. No recipients, subjects, bodies,
// entries, submissions, full addresses, hosts, usernames, passwords, API
// keys, tokens, or any other secret may travel — the validator rejects
// any key outside these allowlists, so a collector regression that added
// such a field fails validation instead of leaking it.
function isTriState(value) {
  return value === null || value === undefined || TRI_STATE.has(value);
}
function validateContactForms(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const out = [];
  for (const f of value) {
    if (!f || typeof f !== "object" || Array.isArray(f)) return null;
    for (const key of Object.keys(f)) {
      if (!["pluginId", "name", "installed", "active", "version", "adapterName", "adapterVersion", "coverage", "formsCount", "notificationConfigured", "mailConfigStatus"].includes(key)) return null;
    }
    if (!isBoundedString(f.pluginId, 100) || !isBoundedString(f.name, 200)) return null;
    if (typeof f.installed !== "boolean" || typeof f.active !== "boolean") return null;
    if (!isOptionalVersion(f.version)) return null;
    if (!isOptionalBoundedString(f.adapterName, 100) || !isOptionalBoundedString(f.adapterVersion, 50)) return null;
    if (!CONTACT_COVERAGE.has(f.coverage)) return null;
    if (f.formsCount !== null && f.formsCount !== undefined && (!Number.isInteger(f.formsCount) || f.formsCount < 0 || f.formsCount > 100000)) return null;
    if (!isTriState(f.notificationConfigured)) return null;
    if (f.mailConfigStatus !== null && f.mailConfigStatus !== undefined && !MAIL_CONFIG_STATUS.has(f.mailConfigStatus)) return null;
    out.push({
      pluginId: f.pluginId, name: f.name, installed: f.installed, active: f.active,
      version: f.version ?? null, adapterName: f.adapterName ?? null,
      adapterVersion: f.adapterVersion ?? null, coverage: f.coverage,
      formsCount: f.formsCount ?? null,
      notificationConfigured: f.notificationConfigured ?? null,
      mailConfigStatus: f.mailConfigStatus ?? null,
    });
  }
  return out;
}
function validateMailTransport(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const out = [];
  for (const m of value) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return null;
    for (const key of Object.keys(m)) {
      if (!["pluginId", "name", "installed", "active", "version", "configPresent", "requiredFieldsComplete", "mailer", "senderConfigured", "senderDomain", "coverage"].includes(key)) return null;
    }
    if (!isBoundedString(m.pluginId, 100) || !isBoundedString(m.name, 200)) return null;
    if (typeof m.installed !== "boolean" || typeof m.active !== "boolean") return null;
    if (!isOptionalVersion(m.version)) return null;
    if (!isTriState(m.configPresent) || !isTriState(m.requiredFieldsComplete) || !isTriState(m.senderConfigured)) return null;
    if (m.mailer !== null && m.mailer !== undefined && !MAILER_IDS.has(m.mailer)) return null;
    // Domain only: no "@", no full address, bounded, DNS-label-safe.
    if (m.senderDomain !== null && m.senderDomain !== undefined) {
      if (typeof m.senderDomain !== "string" || m.senderDomain.length > 253 || m.senderDomain.includes("@") || !/^[a-z0-9.-]+$/i.test(m.senderDomain)) return null;
    }
    if (!CONTACT_COVERAGE.has(m.coverage)) return null;
    out.push({
      pluginId: m.pluginId, name: m.name, installed: m.installed, active: m.active,
      version: m.version ?? null, configPresent: m.configPresent ?? null,
      requiredFieldsComplete: m.requiredFieldsComplete ?? null,
      mailer: m.mailer ?? null, senderConfigured: m.senderConfigured ?? null,
      senderDomain: m.senderDomain ?? null, coverage: m.coverage,
    });
  }
  return out;
}
function validateSenderDomain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of Object.keys(value)) {
    if (!["senderConfigured", "senderDomain", "domainMatches", "comparisonEstablished"].includes(key)) return null;
  }
  if (!TRI_STATE.has(value.senderConfigured)) return null;
  if (value.senderDomain !== null && (typeof value.senderDomain !== "string" || value.senderDomain.length > 253 || value.senderDomain.includes("@") || !/^[a-z0-9.-]+$/i.test(value.senderDomain))) return null;
  if (value.domainMatches !== null && typeof value.domainMatches !== "boolean") return null;
  if (typeof value.comparisonEstablished !== "boolean") return null;
  return {
    senderConfigured: value.senderConfigured,
    senderDomain: value.senderDomain ?? null,
    domainMatches: value.domainMatches ?? null,
    comparisonEstablished: value.comparisonEstablished,
  };
}

function validateEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of Object.keys(value)) if (!ENVIRONMENT_KEYS.has(key)) return null;
  for (const key of ENVIRONMENT_KEYS) {
    const v = value[key];
    if (v !== null && v !== undefined && (typeof v !== "string" || v.length > 50)) return null;
  }
  return {
    phpMemoryLimit: value.phpMemoryLimit ?? null,
    wpMemoryLimit: value.wpMemoryLimit ?? null,
    maxExecutionTime: value.maxExecutionTime ?? null,
  };
}

const MALWARE_SCAN_STATUS = new Set(["COMPLETED", "PARTIAL", "FAILED"]);
const MALWARE_CHECKSUM_STATUS = new Set(["OK", "PROVIDER_UNAVAILABLE", "REFERENCE_UNSUPPORTED"]);
const MALWARE_EVIDENCE_CATEGORY = new Set(["static-signature", "uploads-executable"]);
const MALWARE_CONFIDENCE = new Set(["LOW", "MEDIUM", "HIGH"]);
const MALWARE_SIZE_BAND = new Set(["small", "medium", "large"]);

function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 500
    && !value.startsWith("/") && !value.includes("\\") && !value.includes("\0")
    && !value.split("/").some((part) => part === ".." || part === "");
}

function isBoundedInt(value, max = 100000) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

// Milestone 13 (schema v7) — bounded sanitized malware-scan summary.
// Strict on every present value (unknown keys, file contents, source
// snippets, secrets, or absolute paths reject the whole payload), but
// lenient about absence: a missing malwareScan, or missing sub-objects
// inside it, defaults to unknown/incomplete — never to a clean result.
// The returned object is a fresh minimized copy.
function validateMalwareScan(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of Object.keys(value)) {
    if (!["scanTimestamp", "algorithmVersion", "ruleSetVersion", "status", "coverage", "checksums", "findings"].includes(key)) return null;
  }
  if (value.scanTimestamp !== null && value.scanTimestamp !== undefined && !isBoundedInt(value.scanTimestamp, 4102444800)) return null;
  if (value.algorithmVersion !== null && value.algorithmVersion !== undefined && !isOptionalBoundedString(value.algorithmVersion, 50)) return null;
  if (value.ruleSetVersion !== null && value.ruleSetVersion !== undefined && !isOptionalBoundedString(value.ruleSetVersion, 50)) return null;
  if (value.status !== null && value.status !== undefined && !MALWARE_SCAN_STATUS.has(value.status)) return null;

  let coverage = { filesInspected: 0, filesSkipped: 0, skippedByReason: {}, limitReached: false, limitsHit: [] };
  if (value.coverage !== null && value.coverage !== undefined) {
    const c = value.coverage;
    if (typeof c !== "object" || Array.isArray(c)) return null;
    for (const key of Object.keys(c)) {
      if (!["filesInspected", "filesSkipped", "skippedByReason", "limitReached", "limitsHit"].includes(key)) return null;
    }
    if (c.filesInspected !== null && c.filesInspected !== undefined && !isBoundedInt(c.filesInspected)) return null;
    if (c.filesSkipped !== null && c.filesSkipped !== undefined && !isBoundedInt(c.filesSkipped)) return null;
    if (c.limitReached !== null && c.limitReached !== undefined && typeof c.limitReached !== "boolean") return null;
    let reasons = {};
    if (c.skippedByReason !== null && c.skippedByReason !== undefined) {
      if (typeof c.skippedByReason !== "object" || Array.isArray(c.skippedByReason)) return null;
      const keys = Object.keys(c.skippedByReason);
      if (keys.length > 20) return null;
      for (const k of keys) {
        if (!isBoundedString(k, 50) || !isBoundedInt(c.skippedByReason[k])) return null;
        reasons[k] = c.skippedByReason[k];
      }
    }
    let limits = [];
    if (c.limitsHit !== null && c.limitsHit !== undefined) {
      if (!Array.isArray(c.limitsHit) || c.limitsHit.length > 20) return null;
      for (const l of c.limitsHit) {
        if (!isBoundedString(l, 50)) return null;
        limits.push(l);
      }
    }
    coverage = {
      filesInspected: c.filesInspected ?? 0,
      filesSkipped: c.filesSkipped ?? 0,
      skippedByReason: reasons,
      limitReached: c.limitReached ?? false,
      limitsHit: limits,
    };
  }

  function validateChecksumComponent(comp, { allowUnexpected = false } = {}) {
    if (comp === null || comp === undefined) return null;
    if (typeof comp !== "object" || Array.isArray(comp)) return null;
    const allowed = ["status", "verifiedCount", "mismatchCount", ...(allowUnexpected ? ["unexpectedCount", "unexpectedFiles"] : []), "mismatches"];
    for (const key of Object.keys(comp)) if (!allowed.includes(key)) return null;
    if (comp.status !== null && comp.status !== undefined && !MALWARE_CHECKSUM_STATUS.has(comp.status)) return null;
    if (comp.verifiedCount !== null && comp.verifiedCount !== undefined && !isBoundedInt(comp.verifiedCount)) return null;
    if (comp.mismatchCount !== null && comp.mismatchCount !== undefined && !isBoundedInt(comp.mismatchCount)) return null;
    if (allowUnexpected) {
      if (comp.unexpectedCount !== null && comp.unexpectedCount !== undefined && !isBoundedInt(comp.unexpectedCount)) return null;
      if (comp.unexpectedFiles !== null && comp.unexpectedFiles !== undefined) {
        if (!Array.isArray(comp.unexpectedFiles) || comp.unexpectedFiles.length > 20) return null;
        for (const p of comp.unexpectedFiles) if (!isSafeRelativePath(p)) return null;
      }
    }
    let mismatches = [];
    if (comp.mismatches !== null && comp.mismatches !== undefined) {
      if (!Array.isArray(comp.mismatches) || comp.mismatches.length > 50) return null;
      for (const p of comp.mismatches) {
        if (!isSafeRelativePath(p)) return null;
        mismatches.push(p);
      }
    }
    const out = {
      status: comp.status ?? "REFERENCE_UNSUPPORTED",
      verifiedCount: comp.verifiedCount ?? 0,
      mismatchCount: comp.mismatchCount ?? mismatches.length,
      mismatches,
    };
    if (allowUnexpected) {
      out.unexpectedCount = comp.unexpectedCount ?? (comp.unexpectedFiles ? comp.unexpectedFiles.length : 0);
      out.unexpectedFiles = comp.unexpectedFiles ? [...comp.unexpectedFiles] : [];
    }
    return out;
  }

  let checksums = {
    core: { status: "REFERENCE_UNSUPPORTED", verifiedCount: 0, mismatchCount: 0, mismatches: [], unexpectedCount: 0, unexpectedFiles: [] },
    plugins: [],
    theme: { status: "REFERENCE_UNSUPPORTED" },
  };
  if (value.checksums !== null && value.checksums !== undefined) {
    const cs = value.checksums;
    if (typeof cs !== "object" || Array.isArray(cs)) return null;
    for (const key of Object.keys(cs)) if (!["core", "plugins", "theme"].includes(key)) return null;
    const core = validateChecksumComponent(cs.core, { allowUnexpected: true });
    if (cs.core !== null && cs.core !== undefined && core === null) return null;
    if (core) checksums.core = core;
    if (cs.plugins !== null && cs.plugins !== undefined) {
      if (!Array.isArray(cs.plugins) || cs.plugins.length > 50) return null;
      const plugins = [];
      for (const p of cs.plugins) {
        if (typeof p !== "object" || Array.isArray(p)) return null;
        for (const key of Object.keys(p)) if (!["slug", "version", "status", "verifiedCount", "mismatchCount", "mismatches"].includes(key)) return null;
        if (p.slug !== null && p.slug !== undefined && !/^[a-z0-9][a-z0-9_-]*$/i.test(p.slug)) return null;
        if (!isOptionalVersion(p.version)) return null;
        if (p.status !== null && p.status !== undefined && !MALWARE_CHECKSUM_STATUS.has(p.status)) return null;
        if (p.verifiedCount !== null && p.verifiedCount !== undefined && !isBoundedInt(p.verifiedCount)) return null;
        if (p.mismatchCount !== null && p.mismatchCount !== undefined && !isBoundedInt(p.mismatchCount)) return null;
        const comp = validateChecksumComponent({ status: p.status, verifiedCount: p.verifiedCount, mismatchCount: p.mismatchCount, mismatches: p.mismatches });
        if (comp === null) return null;
        plugins.push({ slug: p.slug ?? null, version: p.version ?? null, ...comp });
      }
      checksums.plugins = plugins;
    }
    if (cs.theme !== null && cs.theme !== undefined) {
      if (typeof cs.theme !== "object" || Array.isArray(cs.theme)) return null;
      for (const key of Object.keys(cs.theme)) if (key !== "status") return null;
      if (cs.theme.status !== null && cs.theme.status !== undefined && !MALWARE_CHECKSUM_STATUS.has(cs.theme.status)) return null;
      checksums.theme = { status: cs.theme.status ?? "REFERENCE_UNSUPPORTED" };
    }
  }

  let findings = [];
  if (value.findings !== null && value.findings !== undefined) {
    if (!Array.isArray(value.findings) || value.findings.length > 50) return null;
    for (const f of value.findings) {
      if (typeof f !== "object" || Array.isArray(f)) return null;
      for (const key of Object.keys(f)) {
        if (!["ruleId", "rules", "relativePath", "evidenceCategory", "confidence", "component", "sizeBand"].includes(key)) return null;
      }
      if (!isBoundedString(f.ruleId, 50)) return null;
      let rules = [];
      if (f.rules !== null && f.rules !== undefined) {
        if (!Array.isArray(f.rules) || f.rules.length > 10) return null;
        for (const r of f.rules) {
          if (!isBoundedString(r, 50)) return null;
          rules.push(r);
        }
      }
      if (!isSafeRelativePath(f.relativePath)) return null;
      if (!MALWARE_EVIDENCE_CATEGORY.has(f.evidenceCategory)) return null;
      if (!MALWARE_CONFIDENCE.has(f.confidence)) return null;
      if (!isOptionalBoundedString(f.component, 200)) return null;
      if (f.sizeBand !== null && f.sizeBand !== undefined && !MALWARE_SIZE_BAND.has(f.sizeBand)) return null;
      findings.push({
        ruleId: f.ruleId, rules, relativePath: f.relativePath,
        evidenceCategory: f.evidenceCategory, confidence: f.confidence,
        component: f.component ?? null, sizeBand: f.sizeBand ?? null,
      });
    }
  }

  return {
    scanTimestamp: value.scanTimestamp ?? null,
    algorithmVersion: value.algorithmVersion ?? null,
    ruleSetVersion: value.ruleSetVersion ?? null,
    status: value.status ?? "FAILED",
    coverage,
    checksums,
    findings,
  };
}

function validateSecurityIndicators(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of Object.keys(value)) if (!SECURITY_INDICATOR_KEYS.has(key)) return null;
  const out = {};
  for (const key of SECURITY_INDICATOR_KEYS) {
    const v = value[key];
    if (v !== "yes" && v !== "no" && v !== "unknown") return null;
    out[key] = v;
  }
  return out;
}

export function validateSnapshot(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return invalid();
  if (payload.schemaVersion !== 1 && payload.schemaVersion !== 2 && payload.schemaVersion !== 3 && payload.schemaVersion !== 4 && payload.schemaVersion !== 5 && payload.schemaVersion !== 6 && payload.schemaVersion !== 7) return invalid();
  const allowed = payload.schemaVersion === 7 ? V7_KEYS : payload.schemaVersion === 6 ? V6_KEYS : payload.schemaVersion === 5 ? V5_KEYS : payload.schemaVersion === 4 ? V4_KEYS : payload.schemaVersion === 3 ? V3_KEYS : payload.schemaVersion === 2 ? V2_KEYS : V1_KEYS;
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) return invalid();
  }
  if (!isBoundedString(payload.wordpressVersion, 50)) return invalid();
  if (!isBoundedString(payload.phpVersion, 50)) return invalid();
  if (!isBoundedString(payload.homeUrl)) return invalid();
  if (!isBoundedString(payload.siteUrl)) return invalid();
  if (!isBoundedString(payload.pluginVersion, 50)) return invalid();
  const activePlugins = validateActivePlugins(payload.activePlugins);
  if (activePlugins === null) return invalid();
  const activeTheme = validateActiveTheme(payload.activeTheme);
  if (activeTheme === undefined) return invalid();
  if (typeof payload.multisite !== "boolean") return invalid();
  if (!isOptionalBoundedString(payload.locale, 20)) return invalid();

  const base = {
    schemaVersion: payload.schemaVersion,
    wordpressVersion: payload.wordpressVersion,
    phpVersion: payload.phpVersion,
    homeUrl: payload.homeUrl,
    siteUrl: payload.siteUrl,
    pluginVersion: payload.pluginVersion,
    activePlugins,
    activeTheme,
    multisite: payload.multisite,
    locale: payload.locale ?? null,
  };
  if (payload.schemaVersion === 1) return { ok: true, snapshot: base };
  if (payload.schemaVersion === 3 && !("woocommerce" in payload)) return invalid();

  // ---- v2 extras ----
  if (!Array.isArray(payload.plugins) || payload.plugins.length > MAX_PLUGINS) return invalid();
  const plugins = [];
  for (const p of payload.plugins) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return invalid();
    for (const key of Object.keys(p)) if (!PLUGIN_KEYS.has(key)) return invalid();
    if (!isBoundedString(p.name, 200)) return invalid();
    if (p.slug !== null && p.slug !== undefined && !/^[a-z0-9][a-z0-9_-]*$/i.test(p.slug)) return invalid();
    if (!isOptionalVersion(p.version)) return invalid();
    if (typeof p.active !== "boolean" || typeof p.networkActive !== "boolean" || typeof p.muPlugin !== "boolean") return invalid();
    if (!isOptionalVersion(p.requiresWP) || !isOptionalVersion(p.requiresPHP)) return invalid();
    if (!Array.isArray(p.dependencies) || p.dependencies.length > 50) return invalid();
    for (const d of p.dependencies) {
      if (typeof d !== "string" || d.length === 0 || d.length > 100 || !/^[a-z0-9][a-z0-9_-]*$/i.test(d)) return invalid();
    }
    if (typeof p.updateAvailable !== "boolean") return invalid();
    if (!isOptionalVersion(p.newVersion)) return invalid();
    if (p.updateCheckedAt !== null && p.updateCheckedAt !== undefined && (!Number.isInteger(p.updateCheckedAt) || p.updateCheckedAt < 0)) return invalid();
    plugins.push({
      name: p.name,
      slug: p.slug ?? null,
      version: p.version ?? null,
      active: p.active,
      networkActive: p.networkActive,
      muPlugin: p.muPlugin,
      requiresWP: p.requiresWP ?? null,
      requiresPHP: p.requiresPHP ?? null,
      dependencies: [...p.dependencies],
      updateAvailable: p.updateAvailable,
      newVersion: p.newVersion ?? null,
      updateCheckedAt: p.updateCheckedAt ?? null,
    });
  }
  let theme = null;
  if (payload.theme !== null && payload.theme !== undefined) {
    const t = payload.theme;
    if (typeof t !== "object" || Array.isArray(t)) return invalid();
    const themeKeys = payload.schemaVersion === 7 ? V7_THEME_KEYS : THEME_KEYS;
    for (const key of Object.keys(t)) if (!themeKeys.has(key)) return invalid();
    if (!isBoundedString(t.name, 200) || !isOptionalVersion(t.version)) return invalid();
    if (!isOptionalBoundedString(t.parentName, 200) || !isOptionalVersion(t.parentVersion)) return invalid();
    if (!isOptionalVersion(t.requiresWP) || !isOptionalVersion(t.requiresPHP)) return invalid();
    if (t.slug !== null && t.slug !== undefined && !/^[a-z0-9][a-z0-9_-]*$/i.test(t.slug)) return invalid();
    theme = {
      name: t.name,
      version: t.version ?? null,
      parentName: t.parentName ?? null,
      parentVersion: t.parentVersion ?? null,
      requiresWP: t.requiresWP ?? null,
      requiresPHP: t.requiresPHP ?? null,
    };
    if (payload.schemaVersion === 7) theme.slug = t.slug ?? null;
  }
  if (payload.schemaVersion === 2) return { ok: true, snapshot: { ...base, plugins, theme } };
  // ---- v3 extras: WooCommerce (required for v3) ----
  const woocommerce = validateWooCommerce(payload.woocommerce);
  if (woocommerce === null) return invalid();
  if (payload.schemaVersion === 3) return { ok: true, snapshot: { ...base, plugins, theme, woocommerce } };
  // ---- v4 extras: Elementor + environment (required for v4) ----
  const elementor = validateElementor(payload.elementor);
  if (elementor === null) return invalid();
  const environment = validateEnvironment(payload.environment);
  if (environment === null) return invalid();
  if (payload.schemaVersion === 4) return { ok: true, snapshot: { ...base, plugins, theme, woocommerce, elementor, environment } };
  // ---- v5 extras: contact forms + mail transport + sender domain ----
  const contactForms = validateContactForms(payload.contactForms);
  if (contactForms === null) return invalid();
  const mailTransport = validateMailTransport(payload.mailTransport);
  if (mailTransport === null) return invalid();
  const senderDomain = validateSenderDomain(payload.senderDomain);
  if (senderDomain === null) return invalid();
  if (payload.schemaVersion === 5) return { ok: true, snapshot: { ...base, plugins, theme, woocommerce, elementor, environment, contactForms, mailTransport, senderDomain } };
  // ---- v6 extras: security indicators (required for v6) ----
  const securityIndicators = validateSecurityIndicators(payload.securityIndicators);
  if (securityIndicators === null) return invalid();
  if (payload.schemaVersion === 6) return { ok: true, snapshot: { ...base, plugins, theme, woocommerce, elementor, environment, contactForms, mailTransport, senderDomain, securityIndicators } };
  // ---- v7 extras: malware scan summary (OPTIONAL — absence means the
  // local inspection has not run, never "no malware").
  const malwareScan = validateMalwareScan(payload.malwareScan);
  if (payload.malwareScan !== null && payload.malwareScan !== undefined && malwareScan === null) return invalid();
  return { ok: true, snapshot: { ...base, plugins, theme, woocommerce, elementor, environment, contactForms, mailTransport, senderDomain, securityIndicators, malwareScan } };
}
