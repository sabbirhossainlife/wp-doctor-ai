// Deterministic Elementor & Layout Checker (Milestone 8).
// Pure functions over a stored connector snapshot + user-reported symptoms.
// No AI, no network, no site modification, no rendering, no browser console
// data, no screenshot/image analysis. Hard invariants:
//  - Installed/active Elementor does NOT prove the editor or layout works.
//  - Pro installed does NOT mean a version conflict; both installed+active
//    is NOT a conflict, and no Elementor<->Pro version-pair rule is encoded
//    (no trustworthy pair table was verified).
//  - A symptom that appeared after an update does NOT prove the update
//    caused it.
//  - A configured memory limit below a recommendation is a WARNING, never
//    proof of memory exhaustion; a configured limit is not observed usage.
//  - HTTP 200 is never treated as "layout correct" — no HTTP check exists
//    here at all, and visual condition is explicitly UNVERIFIED.
//  - A user-reported JS error is NEVER an independently verified browser
//    console error; the excerpt is untrusted context only and its text is
//    never embedded in a finding and never logged.
//  - A missing field in a legacy snapshot is NEVER a negative finding.
//  - A subdirectory difference between home and site URLs is LEGITIMATE,
//    never a URL mismatch (only protocol/hostname mismatch counts).
//  - Safe Mode is an editor troubleshooting mechanism, never a guaranteed
//    or universal fix, and never a fix for live-page layout.
//  - No visual test exists in this milestone, so no finding ever claims a
//    visual/layout condition was verified.
//  - A conflict candidate is NEVER a confirmed conflict: no isolation was
//    performed, nothing was deactivated, no theme was switched.
//
// Finding vocabulary (Tools 02/03 literals, used consistently):
//   CONFIRMED_COMPATIBILITY | POTENTIAL | INSUFFICIENT_EVIDENCE
// Rules: A Elementor missing/inactive; B Pro status; C declared PHP/WP
//   requirements; D memory-limit warning band; E editor/preview symptom
//   context; F URL mismatch (protocol/hostname only); G conflict
//   candidates (Tool 02 concept, not a duplicate of its rules);
//   H JS/CSS errors (no console data); I frontend layout (visual
//   unverified); J insufficient evidence.
//
// Documented sources (checked 2026-10-27, see docs/elementor-layout-checker.md):
//   - Elementor Help "Safe Mode" / "Preview Could Not Be Loaded" / "Safe Mode
//     Activation Isn't Solving My Problem": Safe Mode loads the editor
//     without theme styles / third-party plugin scripts for the signed-in
//     administrator only; if it still fails, check memory limit (256M/512M),
//     matching Site/WordPress URLs, loader method, console/security headers.
//   - Elementor system requirements as quoted by secondary sources on
//     2026-10-21: WP 6.5-6.8+ (sources differ), PHP 7.4 minimum / 8.3+ highly
//     recommended, WP memory 256 MB (512 MB recommended, 768 MB best). The
//     engine therefore uses plugin-declared headers for version rules and
//     256 MB ONLY as a warning band for memory — never a precise cutoff
//     presented as an official hard failure line.

import { isBelowMinimum } from "../conflict/versions.js";

export const FINDING_STATUSES = ["CONFIRMED_COMPATIBILITY", "POTENTIAL", "INSUFFICIENT_EVIDENCE"];

// Warning band only (see header): below this configured limit, warn.
// This is NOT an official "below this, Elementor fails" line.
export const MEMORY_WARNING_BYTES = 256 * 1024 * 1024;

const ELEMENTOR_STATUSES = new Set(["AVAILABLE", "NOT_INSTALLED", "INACTIVE", "UNKNOWN"]);
const EDITOR_CATEGORIES = new Set([
  "ELEMENTOR_EDITOR_NOT_LOADING",
  "ELEMENTOR_EDITOR_WHITE_SCREEN",
  "ELEMENTOR_EDITOR_GRAY_SCREEN",
  "ELEMENTOR_EDITOR_STUCK_LOADING",
  "ELEMENTOR_PREVIEW_NOT_LOADING",
  "ELEMENTOR_WIDGET_PANEL_NOT_LOADING",
]);
const FRONTEND_CATEGORIES = new Set(["FRONTEND_LAYOUT_BROKEN", "MOBILE_LAYOUT_ISSUE"]);
const JS_CSS_CATEGORIES = new Set(["ELEMENTOR_JAVASCRIPT_ERROR", "ELEMENTOR_CSS_OR_ASSET_ISSUE"]);

function boundedString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finding(fields) {
  return {
    ruleId: fields.ruleId,
    category: fields.category,
    severity: fields.severity,
    status: fields.status,
    title: fields.title,
    description: fields.description,
    evidence: fields.evidence ?? {},
    referencedItems: fields.referencedItems ?? [],
    recommendation: fields.recommendation,
    confidence: fields.confidence,
    requiredAdditionalEvidence: fields.requiredAdditionalEvidence ?? null,
  };
}

function pluginRef(name, slug, version) {
  return { kind: "plugin", name, slug: slug ?? null, version: version ?? null };
}

// Parses PHP memory strings: "256M", "512M", "1G", "128K", "268435456",
// "-1" (unlimited) -> Infinity. Returns bytes, Infinity, or null.
export function parseMemoryLimit(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed === "-1") return Infinity;
  const match = /^(\d+(?:\.\d+)?)\s*([KMG])?$/i.exec(trimmed);
  if (!match) return null;
  const num = Number.parseFloat(match[1]);
  if (!Number.isFinite(num)) return null;
  const mult = match[2] ? { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 }[match[2].toUpperCase()] : 1;
  return Math.floor(num * mult);
}

export function normalizeElementorSnapshot(snapshot) {
  const s = snapshot && typeof snapshot === "object" ? snapshot : {};
  const schemaVersion = s.schemaVersion === 4 ? 4 : s.schemaVersion === 3 ? 3 : s.schemaVersion === 2 ? 2 : 1;
  const plugins = Array.isArray(s.plugins) ? s.plugins : null;
  const elementorRaw = s.schemaVersion === 4 && s.elementor && typeof s.elementor === "object" ? s.elementor : null;
  let elementor = null;
  if (elementorRaw) {
    const pro = elementorRaw.pro && typeof elementorRaw.pro === "object" ? elementorRaw.pro : null;
    elementor = {
      installed: elementorRaw.installed === true,
      active: elementorRaw.active === true,
      version: boundedString(elementorRaw.version),
      pro: pro
        ? { installed: pro.installed === true, active: pro.active === true, version: boundedString(pro.version) }
        : { installed: false, active: false, version: null },
      status: ELEMENTOR_STATUSES.has(elementorRaw.status) ? elementorRaw.status : "UNKNOWN",
    };
  }
  const envRaw = s.schemaVersion === 4 && s.environment && typeof s.environment === "object" ? s.environment : null;
  const environment = envRaw
    ? {
        phpMemoryLimit: boundedString(envRaw.phpMemoryLimit),
        wpMemoryLimit: boundedString(envRaw.wpMemoryLimit),
        maxExecutionTime: boundedString(envRaw.maxExecutionTime),
      }
    : null;
  const findPlugin = (slugs, names) => {
    if (!plugins) return null;
    return (
      plugins.find(
        (p) =>
          p &&
          typeof p === "object" &&
          ((typeof p.slug === "string" && slugs.includes(p.slug.toLowerCase())) ||
            (typeof p.name === "string" && names.includes(p.name.trim().toLowerCase()))),
      ) ?? null
    );
  };
  const freePlugin = findPlugin(["elementor"], ["elementor"]);
  const proPlugin = findPlugin(["elementor-pro"], ["elementor pro"]);
  const otherActive = plugins
    ? plugins.filter(
        (p) =>
          p &&
          typeof p === "object" &&
          (p.active === true || p.networkActive === true) &&
          p !== freePlugin &&
          p !== proPlugin &&
          typeof p.name === "string",
      )
    : null;
  return {
    schemaVersion,
    wordpressVersion: boundedString(s.wordpressVersion),
    phpVersion: boundedString(s.phpVersion),
    homeUrl: boundedString(s.homeUrl),
    siteUrl: boundedString(s.siteUrl),
    theme: s.theme && typeof s.theme === "object" ? s.theme : null,
    plugins,
    elementor,
    environment,
    freePlugin: freePlugin
      ? {
          name: freePlugin.name,
          slug: freePlugin.slug ?? null,
          version: boundedString(freePlugin.version),
          active: freePlugin.active === true || freePlugin.networkActive === true,
          requiresWP: boundedString(freePlugin.requiresWP),
          requiresPHP: boundedString(freePlugin.requiresPHP),
        }
      : null,
    proPlugin: proPlugin
      ? {
          name: proPlugin.name,
          slug: proPlugin.slug ?? null,
          version: boundedString(proPlugin.version),
          active: proPlugin.active === true || proPlugin.networkActive === true,
          requiresWP: boundedString(proPlugin.requiresWP),
          requiresPHP: boundedString(proPlugin.requiresPHP),
        }
      : null,
    otherActive,
  };
}

function urlParts(url) {
  try {
    const u = new URL(url);
    return { protocol: u.protocol, hostname: u.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

// symptom: { category, description, affectedScope, affectedPages,
//   deviceScope, updatePreceded, startedAt, errorExcerpt } — user-reported,
//   untrusted context. Returns { findings, skipped }.
export function runElementorRules(snapshot, symptom = {}) {
  const n = normalizeElementorSnapshot(snapshot);
  const findings = [];
  const skipped = [];
  const el = n.elementor;
  const category = typeof symptom?.category === "string" ? symptom.category : "OTHER_OR_UNKNOWN";
  const description = typeof symptom?.description === "string" ? symptom.description : "";
  const hasExcerpt = typeof symptom?.errorExcerpt === "string" && symptom.errorExcerpt.trim().length > 0;
  const updatePreceded = symptom?.updatePreceded === true ? true : symptom?.updatePreceded === false ? false : null;

  // ---- Rule A: Elementor missing / inactive (explicit v4 state only) ----
  if (el && el.status === "NOT_INSTALLED") {
    findings.push(
      finding({
        ruleId: "A", category: "ELEMENTOR_PRESENCE", severity: "HIGH", status: "CONFIRMED_COMPATIBILITY",
        title: "Elementor is not installed on this site",
        description: "The snapshot inventory contains no Elementor plugin. Editor and layout checks cannot run because there is no Elementor installation to check. This is a statement about the snapshot inventory, not about any other site.",
        evidence: { declared: null, observed: { elementorStatus: "NOT_INSTALLED" } },
        referencedItems: [pluginRef("Elementor", "elementor", null)],
        recommendation: "If this site should use Elementor, install it from a trusted source on a staging copy first, then sync a fresh snapshot and re-run this check. Do not install plugins on the live site without a backup.",
        confidence: "HIGH",
      }),
    );
  } else if (el && el.status === "INACTIVE") {
    findings.push(
      finding({
        ruleId: "A", category: "ELEMENTOR_PRESENCE", severity: "HIGH", status: "CONFIRMED_COMPATIBILITY",
        title: "Elementor is installed but inactive on this site",
        description: "The snapshot inventory lists Elementor as installed but not active. With Elementor inactive, its editor is not operating and its layouts are not rendered by Elementor. This does not identify why it was deactivated.",
        evidence: { declared: null, observed: { elementorStatus: "INACTIVE", version: el.version } },
        referencedItems: [pluginRef("Elementor", "elementor", el.version)],
        recommendation: "On a staging copy, activate Elementor and re-test the editor, then sync a fresh snapshot and re-run this check. Do not activate plugins on the live site without a backup.",
        confidence: "HIGH",
      }),
    );
  }

  const available = el && el.status === "AVAILABLE";

  // ---- Rule B: Pro status (version information only, never a conflict) ----
  if (el) {
    if (el.pro.installed && el.pro.active && available) {
      // Both installed and active is NOT a conflict: no finding. This is
      // deliberate — no verified Elementor<->Pro version-pair rule exists.
    } else if (el.pro.installed && !el.pro.active) {
      findings.push(
        finding({
          ruleId: "B", category: "ELEMENTOR_PRO_STATUS", severity: "LOW", status: "POTENTIAL",
          title: "Elementor Pro is installed but inactive",
          description: "Elementor Pro is present in the inventory but not active, so Pro features are not available on this site. This is not a version conflict and does not by itself explain an editor or layout symptom.",
          evidence: { declared: null, observed: { proInstalled: true, proActive: false, proVersion: el.pro.version } },
          referencedItems: [pluginRef("Elementor Pro", "elementor-pro", el.pro.version)],
          recommendation: "If Pro features are expected, check on staging whether Pro should be active, then sync a fresh snapshot and re-run this check. Do not change plugin activation on the live site without a backup.",
          confidence: "MEDIUM",
        }),
      );
    } else if (el.pro.installed && el.pro.active && !available) {
      findings.push(
        finding({
          ruleId: "B", category: "ELEMENTOR_PRO_STATUS", severity: "MEDIUM", status: "POTENTIAL",
          title: "Elementor Pro is active but Elementor Free is not available",
          description: "Elementor Pro is active in the inventory while Elementor Free is not available (status: " + el.status + "). Pro builds on Free, so this combination should be reviewed — but this tool does not claim it caused any specific symptom, and it does not change plugin activation.",
          evidence: { declared: null, observed: { elementorStatus: el.status, proActive: true, proVersion: el.pro.version } },
          referencedItems: [pluginRef("Elementor Pro", "elementor-pro", el.pro.version)],
          recommendation: "On staging, confirm Elementor Free is installed and active alongside Pro, then sync a fresh snapshot and re-run this check.",
          confidence: "MEDIUM",
        }),
      );
    }
    if (el.pro.installed && el.pro.version === null) {
      findings.push(
        finding({
          ruleId: "B", category: "ELEMENTOR_PRO_STATUS", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
          title: "Elementor Pro version is unavailable",
          description: "Elementor Pro is installed, but its version could not be read from the snapshot. Pro compatibility therefore cannot be assessed from version information, and no version conflict is claimed.",
          evidence: { declared: null, observed: { proInstalled: true, proVersion: null } },
          referencedItems: [pluginRef("Elementor Pro", "elementor-pro", null)],
          recommendation: "Check the installed Pro version in WordPress (Plugins), then sync a fresh snapshot and re-run this check.",
          confidence: "LOW",
          requiredAdditionalEvidence: "The installed Elementor Pro version.",
        }),
      );
    }
  }

  // ---- Rule C: declared PHP/WP requirements (plugin headers, warning only) ----
  if (available) {
    for (const [plugin, label] of [[n.freePlugin, "Elementor"], [n.proPlugin, "Elementor Pro"]]) {
      if (!plugin) continue;
      for (const [field, observed, observedLabel] of [
        ["requiresPHP", n.phpVersion, "PHP"],
        ["requiresWP", n.wordpressVersion, "WordPress"],
      ]) {
        const required = plugin[field];
        if (required === null) continue;
        const below = isBelowMinimum(observed, required);
        if (below === null) {
          skipped.push({ ruleId: "C", reason: `${label} ${field} "${required}" or site ${observedLabel} version "${observed}" is malformed; comparison skipped.` });
        } else if (below) {
          findings.push(
            finding({
              ruleId: "C", category: "COMPATIBILITY_VERSION", severity: "MEDIUM", status: "POTENTIAL",
              title: `${label} declares a minimum ${observedLabel} version of ${required}, but the site runs ${observedLabel} ${observed}`,
              description: `The ${label} plugin header declares a minimum ${observedLabel} version of ${required}. The site reports ${observedLabel} ${observed}, which is below that minimum. This is a compatibility warning only — it is NOT a confirmed crash, editor failure, or layout break.`,
              evidence: { declared: { [field]: required }, observed: { [`${observedLabel.toLowerCase()}Version`]: observed } },
              referencedItems: [pluginRef(label, plugin.slug, plugin.version)],
              recommendation: "Do not change the live site directly. On a staging copy, upgrade to at least the required version or replace the component, then re-test the editor and frontend.",
              confidence: "MEDIUM",
            }),
          );
        }
      }
    }
  }

  // ---- Rule D: memory-limit warning band (configured, not observed) ----
  if (el) {
    const env = n.environment;
    const effective = env?.wpMemoryLimit ?? env?.phpMemoryLimit ?? null;
    const effectiveSource = env?.wpMemoryLimit ? "wpMemoryLimit" : env?.phpMemoryLimit ? "phpMemoryLimit" : null;
    if (effective === null) {
      findings.push(
        finding({
          ruleId: "D", category: "PHP_OR_ENVIRONMENT", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
          title: "Configured memory limit is unavailable",
          description: "Neither a WordPress memory limit nor a PHP memory limit could be read from the snapshot, so memory cannot be compared against Elementor's documented recommendation. No limit is assumed, and no memory problem is claimed.",
          evidence: { declared: null, observed: { wpMemoryLimit: env?.wpMemoryLimit ?? null, phpMemoryLimit: env?.phpMemoryLimit ?? null } },
          referencedItems: [],
          recommendation: "Check the limits in WordPress (Elementor > System Info, or Tools > Site Health > Info > Server) and ask the hosting provider to confirm them, then sync a fresh snapshot and re-run this check.",
          confidence: "LOW",
          requiredAdditionalEvidence: "The configured WP/PHP memory limit from Elementor System Info or Site Health.",
        }),
      );
    } else {
      const bytes = parseMemoryLimit(effective);
      if (bytes === null) {
        findings.push(
          finding({
            ruleId: "D", category: "PHP_OR_ENVIRONMENT", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
            title: "Configured memory limit could not be parsed",
            description: `The snapshot reports a configured memory limit of "${effective}", which could not be parsed as a byte value. It is not approximated, and no memory problem is claimed.`,
            evidence: { declared: null, observed: { effectiveLimit: effective, effectiveSource } },
            referencedItems: [],
            recommendation: "Confirm the configured limit in Elementor System Info, then sync a fresh snapshot and re-run this check.",
            confidence: "LOW",
            requiredAdditionalEvidence: "A parseable configured memory limit.",
          }),
        );
      } else if (bytes !== Infinity && bytes < MEMORY_WARNING_BYTES) {
        findings.push(
          finding({
            ruleId: "D", category: "PHP_OR_ENVIRONMENT", severity: "MEDIUM", status: "POTENTIAL",
            title: `Configured memory limit (${effective}) is below Elementor's documented 256 MB recommendation`,
            description: `The configured limit (${effective}, from ${effectiveSource}) is below the 256 MB figure Elementor's published system requirements recommend for Elementor/Pro (512 MB recommended, 768 MB for best performance). This is a WARNING only: a configured limit is not observed memory usage, and this finding does NOT prove memory exhaustion, an editor failure, or a layout break.`,
            evidence: { declared: { recommendedMinimumBytes: MEMORY_WARNING_BYTES }, observed: { effectiveLimit: effective, effectiveSource, effectiveBytes: bytes } },
            referencedItems: [],
            recommendation: "Ask the hosting provider (or, on staging, an authorized admin) to review the WP/PHP memory configuration against Elementor's documented recommendation, with a backup and staging test before any live change. If the editor still fails after raising the limit, the cause lies elsewhere.",
            confidence: "MEDIUM",
            requiredAdditionalEvidence: "Whether the editor fails with an observed memory-exhaustion message in server logs, reviewed by the hosting provider.",
          }),
        );
      }
      // At or above 256 MB, or unlimited: no finding. Meeting the
      // recommendation does not prove the editor or layout works.
    }
  }

  // ---- Rule E: editor/preview symptom context only ----
  if (EDITOR_CATEGORIES.has(category) || category === "ELEMENTOR_EDITOR_NOT_LOADING" || description.trim().length > 0) {
    if (EDITOR_CATEGORIES.has(category)) {
      let desc = "The reported editor symptom below is user-reported context only. It describes what was observed; it does not identify a cause, and it is not treated as a verified fact. Related PHP, environment, URL, or asset evidence in other findings may be related to the symptom, but is never claimed as its proven cause.";
      if (updatePreceded === true) {
        desc += " The symptom was reported as appearing after an update; post-update timing alone does NOT prove the update caused it.";
      }
      desc += " Elementor Safe Mode (Elementor > Tools) is an editor troubleshooting mechanism that loads the editor without theme styles and third-party plugin scripts for the signed-in administrator only — it is not a guaranteed fix, it does not fix live-page layout, and it must be disabled again after testing.";
      findings.push(
        finding({
          ruleId: "E", category: "SYMPTOM_CONTEXT", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
          title: "Reported editor symptom recorded as context only",
          description: desc,
          evidence: { declared: null, observed: { symptomCategory: category, hasDescription: description.trim().length > 0, updatePreceded, affectedScope: symptom?.affectedScope ?? null } },
          referencedItems: [],
          recommendation: "Use the configuration findings above to decide what to test on staging; try Safe Mode only as a diagnostic view (an authorized admin, editor session only), record the exact editor step and exact message, and note whether the symptom reproduces on staging.",
          confidence: "LOW",
          requiredAdditionalEvidence: "The exact editor step affected, the exact message shown, and whether the symptom reproduces in Safe Mode and on staging.",
        }),
      );
    }
  }

  // ---- Rule F: URL mismatch (protocol/hostname only) ----
  if (n.homeUrl && n.siteUrl) {
    const home = urlParts(n.homeUrl);
    const site = urlParts(n.siteUrl);
    if (home && site) {
      if (home.protocol !== site.protocol || home.hostname !== site.hostname) {
        findings.push(
          finding({
            ruleId: "F", category: "URL_CONFIGURATION", severity: "MEDIUM", status: "CONFIRMED_COMPATIBILITY",
            title: "WordPress Address and Site Address differ in protocol or hostname",
            description: `The snapshot reports home URL "${n.homeUrl}" and site URL "${n.siteUrl}". Their protocol or hostname differs, which Elementor's troubleshooting documentation lists as a possible cause of editor preview/iframe loading problems (cross-origin framing). This is a configuration observation only — it does not prove the reported symptom was caused by it. A difference in path alone (for example a subdirectory install) would NOT be a mismatch and is not flagged here.`,
            evidence: { declared: null, observed: { homeUrl: n.homeUrl, siteUrl: n.siteUrl, homeProtocol: home.protocol, siteProtocol: site.protocol, homeHostname: home.hostname, siteHostname: site.hostname } },
            referencedItems: [],
            recommendation: "An authorized admin should review Settings > General (WordPress Address vs Site Address) on staging first, match protocol and hostname deliberately, then sync a fresh snapshot and re-run this check. Do not change live URLs without a backup — a wrong URL change can lock out the admin.",
            confidence: "MEDIUM",
          }),
        );
      }
      // Protocol + hostname equal (any path difference, e.g. subdirectory):
      // legitimate — no finding.
    } else {
      skipped.push({ ruleId: "F", reason: "homeUrl or siteUrl could not be parsed; URL comparison skipped." });
    }
  }

  // ---- Rule G: conflict candidates (Tool 02 concept; candidate only) ----
  if (available && n.otherActive && n.otherActive.length > 0) {
    findings.push(
      finding({
        ruleId: "G", category: "CONFLICT_CANDIDATE", severity: "LOW", status: "POTENTIAL",
        title: "Other active plugins are present and are conflict candidates only",
        description: "Other plugins are active alongside Elementor. They are listed as CANDIDATES for investigation only: no conflict has been established, no isolation test was performed by this tool, nothing was deactivated, and no theme was switched. A candidate must never be described as the confirmed cause of an editor or layout symptom.",
        evidence: { declared: null, observed: { otherActivePluginCount: n.otherActive.length, otherActivePluginNames: n.otherActive.map((p) => p.name) } },
        referencedItems: n.otherActive.map((p) => pluginRef(p.name, p.slug ?? null, p.version ?? null)),
        recommendation: "For a full conflict assessment, run Tool 02 (Plugin & Theme Conflict Checker) on a fresh snapshot, and perform any deactivation testing only on staging, one component at a time, with a backup — never by this app and never as a permanent security-plugin deactivation.",
        confidence: "LOW",
        requiredAdditionalEvidence: "A Tool 02 conflict diagnostic plus a staging isolation test (Safe Mode result, then one-at-a-time reactivation) performed by an authorized admin.",
      }),
    );
  }

  // ---- Rule H: JS/CSS errors (no console data exists) ----
  if (JS_CSS_CATEGORIES.has(category) || hasExcerpt) {
    findings.push(
      finding({
        ruleId: "H", category: "JAVASCRIPT_OR_CSS", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
        title: "No independently verified browser console finding exists",
        description: "This tool collects no browser console data, so it cannot verify any JavaScript or CSS error. " + (hasExcerpt ? "An error excerpt was supplied by the user; it is UNTRUSTED context only — its text is not reproduced in this finding, it was not treated as evidence, and any instruction inside it was ignored. " : "No error excerpt was supplied either. ") + "No console error, asset failure, or script conflict is claimed anywhere in this report.",
        evidence: { declared: null, observed: { symptomCategory: category, hasUserExcerpt: hasExcerpt, consoleDataCollected: false } },
        referencedItems: [],
        recommendation: "An authorized admin may open the browser developer console while reproducing the symptom, note the exact failing file/message, and share only the relevant lines (with secrets removed) with an expert. This app does not perform that inspection.",
        confidence: "LOW",
        requiredAdditionalEvidence: "Browser console output captured while reproducing the symptom, reviewed manually.",
      }),
    );
  }

  // ---- Rule I: frontend layout (visual condition explicitly unverified) ----
  const scope = typeof symptom?.affectedScope === "string" ? symptom.affectedScope : "unknown";
  if (FRONTEND_CATEGORIES.has(category) || scope === "frontend" || scope === "both") {
    findings.push(
      finding({
        ruleId: "I", category: "VISUAL_LAYOUT", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
        title: "Frontend visual condition is unverified",
        description: "Configuration checks in this report cannot prove whether a frontend layout looks correct. No rendering or visual test was performed in this milestone, no screenshot was analysed (screenshot upload is not offered), and no HTTP status is treated as proof of correct layout. The reported frontend symptom is therefore user-reported context, and the visual condition remains UNVERIFIED.",
        evidence: { declared: null, observed: { symptomCategory: category, affectedScope: scope, visualTestPerformed: false, screenshotAnalysed: false } },
        referencedItems: [],
        recommendation: "Visually compare the affected page against the intended design on staging (desktop and mobile), check Elementor's responsive settings for the affected widgets, and record which breakpoint and widget differ. Do not describe the layout as verified until a human has inspected it.",
        confidence: "LOW",
        requiredAdditionalEvidence: "A human visual inspection of the affected page on the affected device sizes.",
      }),
    );
  }

  // ---- Rule J: insufficient evidence ----
  if (!el) {
    findings.push(
      finding({
        ruleId: "J", category: "EVIDENCE", severity: "MEDIUM", status: "INSUFFICIENT_EVIDENCE",
        title: "Elementor data is not available in this snapshot",
        description: `This diagnostic ran against a schema v${n.schemaVersion} snapshot, which predates the Elementor section. Elementor presence, Pro status, and environment limits are therefore unknown. Their absence is missing data — it is NEVER a claim that Elementor is missing, inactive, or misconfigured.`,
        evidence: { declared: null, observed: { snapshotSchemaVersion: n.schemaVersion } },
        referencedItems: [],
        recommendation: "Update the connector plugin to version 1.3.0 or later, sync a fresh diagnostic snapshot from the WordPress connector admin page, then re-run this check.",
        confidence: "HIGH",
        requiredAdditionalEvidence: "A v4 snapshot from connector plugin 1.3.0+.",
      }),
    );
  } else {
    if (el.status === "UNKNOWN") {
      findings.push(
        finding({
          ruleId: "J", category: "EVIDENCE", severity: "MEDIUM", status: "INSUFFICIENT_EVIDENCE",
          title: "Elementor presence could not be determined",
          description: "The snapshot carries an Elementor section, but its status is UNKNOWN, so presence, Pro, and requirement checks could not run. Unknown is reported as unknown, not as missing or inactive.",
          evidence: { declared: null, observed: { elementorStatus: "UNKNOWN" } },
          referencedItems: [],
          recommendation: "Sync a fresh diagnostic snapshot from the WordPress connector admin page, then re-run this check.",
          confidence: "MEDIUM",
          requiredAdditionalEvidence: "A fresh v4 snapshot with a determined Elementor status.",
        }),
      );
    }
    if (available && el.version === null) {
      findings.push(
        finding({
          ruleId: "J", category: "EVIDENCE", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
          title: "Elementor version is unknown",
          description: "Elementor is available, but its version could not be read from the snapshot, so version-dependent checks are limited. No version is assumed.",
          evidence: { declared: null, observed: { elementorStatus: "AVAILABLE", version: null } },
          referencedItems: [pluginRef("Elementor", "elementor", null)],
          recommendation: "Check the installed Elementor version in WordPress (Plugins), then sync a fresh snapshot and re-run this check.",
          confidence: "LOW",
          requiredAdditionalEvidence: "The installed Elementor version.",
        }),
      );
    }
    if (!n.plugins) {
      findings.push(
        finding({
          ruleId: "J", category: "EVIDENCE", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
          title: "Plugin inventory is unavailable, so conflict candidates cannot be assessed",
          description: "The snapshot has no full plugin inventory, so other active plugins cannot be listed as conflict candidates. Their absence from this report is missing data, not evidence that no other plugins exist.",
          evidence: { declared: null, observed: { hasPluginInventory: false } },
          referencedItems: [],
          recommendation: "Sync a fresh v4 snapshot (which includes the full inventory) from the WordPress connector admin page, then re-run this check.",
          confidence: "MEDIUM",
          requiredAdditionalEvidence: "A v4 snapshot with the full plugin inventory.",
        }),
      );
    }
  }
  if (skipped.length > 0) {
    findings.push(
      finding({
        ruleId: "J", category: "EVIDENCE", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
        title: "Some checks were skipped because version or URL data was malformed",
        description: "One or more comparisons were skipped because a declared or observed version string or URL could not be parsed. Skipped checks are listed in the evidence; they were not approximated.",
        evidence: { declared: null, observed: { skipped } },
        referencedItems: [],
        recommendation: "Correct the malformed value, sync a fresh snapshot, then re-run this check.",
        confidence: "MEDIUM",
        requiredAdditionalEvidence: "Parseable version strings and URLs for the skipped items.",
      }),
    );
  }

  return { findings, skipped };
}
