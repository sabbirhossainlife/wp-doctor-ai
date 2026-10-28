// Deterministic Plugin & Theme Conflict Checker (Milestone 6).
// Pure functions over a stored connector snapshot + user-reported symptoms.
// No AI, no network, no site modification. Hard invariants:
//  - Two active plugins alone NEVER yield a confirmed conflict: without a
//    declared requirement, dependency, or version incompatibility there is
//    no conflict finding, only insufficient-evidence context.
//  - A post-update symptom NEVER proves causation: symptom text is context
//    only (Rule G) and is never linked to a plugin as a cause.
//  - A version mismatch is a COMPATIBILITY finding, never an invented crash:
//    findings say "requires X, site runs Y", never "plugin Z crashes the site".
//  - No logs are collected, so no finding ever claims log evidence.
//  - No TLS data is collected, so no finding ever mentions TLS.
//  - Missing data stays missing: null fields produce INSUFFICIENT_EVIDENCE,
//    never a fabricated value.
//
// Finding vocabulary (consistent everywhere): status is one of
// CONFIRMED_COMPATIBILITY | POTENTIAL | INSUFFICIENT_EVIDENCE.
// Rule mapping (documented deviation from the brief's letter, same intent):
//   A = plugin PHP-minimum mismatch; B = plugin WP-minimum mismatch;
//   C = declared plugin dependencies; D = active entry without metadata;
//   E = cached update available; F = theme compatibility + parent-theme
//   distinction (theme requires fields live here so a theme mismatch is
//   reported once, not duplicated under A/B); G = symptom context only;
//   H = insufficient evidence / skipped rules.

import { compareVersions, isBelowMinimum } from "./versions.js";

export const FINDING_STATUSES = ["CONFIRMED_COMPATIBILITY", "POTENTIAL", "INSUFFICIENT_EVIDENCE"];

function slugOfPlugin(plugin) {
  if (typeof plugin?.slug === "string" && plugin.slug) return plugin.slug;
  return null;
}

function itemRef(kind, plugin) {
  return { kind, name: plugin?.name ?? null, slug: slugOfPlugin(plugin), version: plugin?.version ?? null };
}

// Normalizes a stored snapshot (v1 or v2) into the shape the rules read.
// v1 has only activePlugins/activeTheme: every plugin becomes active=true
// with all extended fields null, so A/B/C/E cannot run and degrade to H.
// Unknown/inventory fields are never invented here.
export function normalizeSnapshot(snapshot) {
  const s = snapshot && typeof snapshot === "object" ? snapshot : {};
  const schemaVersion = s.schemaVersion === 2 ? 2 : 1;
  let plugins = [];
  if (schemaVersion === 2 && Array.isArray(s.plugins)) {
    plugins = s.plugins.map((p) => ({
      name: typeof p?.name === "string" ? p.name : null,
      slug: typeof p?.slug === "string" ? p.slug : null,
      version: typeof p?.version === "string" ? p.version : null,
      active: p?.active === true,
      networkActive: p?.networkActive === true,
      muPlugin: p?.muPlugin === true,
      requiresWP: typeof p?.requiresWP === "string" ? p.requiresWP : null,
      requiresPHP: typeof p?.requiresPHP === "string" ? p.requiresPHP : null,
      dependencies: Array.isArray(p?.dependencies) ? p.dependencies.filter((d) => typeof d === "string") : [],
      updateAvailable: p?.updateAvailable === true,
      newVersion: typeof p?.newVersion === "string" ? p.newVersion : null,
      updateCheckedAt: typeof p?.updateCheckedAt === "number" ? p.updateCheckedAt : null,
    }));
  } else if (Array.isArray(s.activePlugins)) {
    plugins = s.activePlugins.map((p) => ({
      name: typeof p?.name === "string" ? p.name : null,
      slug: null,
      version: typeof p?.version === "string" ? p.version : null,
      active: true,
      networkActive: false,
      muPlugin: false,
      requiresWP: null,
      requiresPHP: null,
      dependencies: [],
      updateAvailable: false,
      newVersion: null,
      updateCheckedAt: null,
    }));
  }
  let theme = null;
  if (schemaVersion === 2 && s.theme && typeof s.theme === "object") {
    theme = {
      name: typeof s.theme.name === "string" ? s.theme.name : null,
      version: typeof s.theme.version === "string" ? s.theme.version : null,
      parentName: typeof s.theme.parentName === "string" ? s.theme.parentName : null,
      parentVersion: typeof s.theme.parentVersion === "string" ? s.theme.parentVersion : null,
      requiresWP: typeof s.theme.requiresWP === "string" ? s.theme.requiresWP : null,
      requiresPHP: typeof s.theme.requiresPHP === "string" ? s.theme.requiresPHP : null,
    };
  } else if (s.activeTheme && typeof s.activeTheme === "object") {
    theme = {
      name: typeof s.activeTheme.name === "string" ? s.activeTheme.name : null,
      version: typeof s.activeTheme.version === "string" ? s.activeTheme.version : null,
      parentName: null,
      parentVersion: null,
      requiresWP: null,
      requiresPHP: null,
    };
  }
  return {
    schemaVersion,
    wordpressVersion: typeof s.wordpressVersion === "string" ? s.wordpressVersion : null,
    phpVersion: typeof s.phpVersion === "string" ? s.phpVersion : null,
    multisite: s.multisite === true,
    plugins,
    theme,
    activePluginEntries: Array.isArray(s.activePlugins)
      ? s.activePlugins.map((p) => ({ name: typeof p?.name === "string" ? p.name : null, version: typeof p?.version === "string" ? p.version : null }))
      : [],
  };
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

// symptom: { category, description } — user-reported, untrusted context.
// Returns { findings, skipped } where skipped lists rule skips with reasons.
export function runConflictRules(snapshot, symptom = {}) {
  const n = normalizeSnapshot(snapshot);
  const findings = [];
  const skipped = [];
  const skip = (ruleId, reason) => skipped.push({ ruleId, reason });

  // ---- Rule D (inventory integrity first: it qualifies later rules) ----
  // v2: an activePlugins entry with no matching plugins[] entry (by name)
  // means the inventory is incomplete for that plugin.
  if (n.schemaVersion === 2) {
    for (const entry of n.activePluginEntries) {
      const match = n.plugins.find((p) => p.name === entry.name);
      if (!match) {
        findings.push(finding({
          ruleId: "D",
          category: "INVENTORY",
          severity: "LOW",
          status: "INSUFFICIENT_EVIDENCE",
          title: `Active plugin "${entry.name ?? "unknown"}" has no matching inventory entry`,
          description: "The snapshot lists this plugin as active, but the full installed-plugin inventory has no entry for it. Compatibility and dependency checks cannot be run for this plugin until a fresh snapshot is synced.",
          evidence: { declared: null, observed: { activeEntry: entry } },
          referencedItems: [{ kind: "plugin", name: entry.name, slug: null, version: entry.version }],
          recommendation: "Sync a fresh diagnostic snapshot from the WordPress connector admin page, then re-run this check.",
          confidence: "LOW",
          requiredAdditionalEvidence: "A fresh snapshot whose installed-plugin inventory includes this plugin.",
        }));
      } else if (match.version === null || entry.version === null) {
        findings.push(finding({
          ruleId: "D",
          category: "INVENTORY",
          severity: "LOW",
          status: "INSUFFICIENT_EVIDENCE",
          title: `Active plugin "${match.name}" is missing version metadata`,
          description: "The plugin is active but its version could not be read from its header. Version-based compatibility checks are skipped for this plugin.",
          evidence: { declared: null, observed: { activeEntry: entry, inventoryEntry: { name: match.name, version: match.version } } },
          referencedItems: [itemRef("plugin", match)],
          recommendation: "Check the plugin header on the site and sync a fresh snapshot, then re-run this check.",
          confidence: "LOW",
          requiredAdditionalEvidence: "The plugin version from its header.",
        }));
      }
    }
    const seenSlugs = new Set();
    for (const p of n.plugins) {
      if (p.slug) {
        if (seenSlugs.has(p.slug)) {
          findings.push(finding({
            ruleId: "D",
            category: "INVENTORY",
            severity: "LOW",
            status: "INSUFFICIENT_EVIDENCE",
            title: `Duplicate inventory entry for plugin slug "${p.slug}"`,
            description: "The snapshot inventory lists the same plugin slug more than once. Results for this plugin may be incomplete; a fresh snapshot is recommended.",
            evidence: { declared: null, observed: { slug: p.slug } },
            referencedItems: [itemRef("plugin", p)],
            recommendation: "Sync a fresh diagnostic snapshot, then re-run this check.",
            confidence: "LOW",
            requiredAdditionalEvidence: "A de-duplicated plugin inventory.",
          }));
        }
        seenSlugs.add(p.slug);
      }
    }
  } else {
    // v1: version metadata beyond name/version is absent by construction.
    for (const entry of n.activePluginEntries) {
      if (entry.version === null) {
        findings.push(finding({
          ruleId: "D",
          category: "INVENTORY",
          severity: "LOW",
          status: "INSUFFICIENT_EVIDENCE",
          title: `Active plugin "${entry.name ?? "unknown"}" is missing version metadata`,
          description: "The snapshot lists this plugin as active but no version was recorded. Version-based checks cannot run for it.",
          evidence: { declared: null, observed: { activeEntry: entry } },
          referencedItems: [{ kind: "plugin", name: entry.name, slug: null, version: null }],
          recommendation: "Sync an extended (v2) snapshot from the connector admin page, then re-run this check.",
          confidence: "LOW",
          requiredAdditionalEvidence: "A v2 snapshot with full plugin metadata.",
        }));
      }
    }
  }

  // ---- Rules A + B (plugins) ----
  if (n.schemaVersion === 1) {
    skip("A", "Extended snapshot required: plugin PHP requirements are not present in a v1 snapshot.");
    skip("B", "Extended snapshot required: plugin WordPress requirements are not present in a v1 snapshot.");
    skip("C", "Extended snapshot required: plugin dependencies are not present in a v1 snapshot.");
    skip("E", "Extended snapshot required: update information is not present in a v1 snapshot.");
  } else {
    for (const p of n.plugins) {
      if (!p.active) continue;
      if (p.requiresPHP !== null) {
        const below = isBelowMinimum(n.phpVersion, p.requiresPHP);
        if (below === null) skip("A", `Plugin "${p.name}" PHP requirement "${p.requiresPHP}" or site PHP version "${n.phpVersion}" is malformed; comparison skipped.`);
        else if (below) {
          findings.push(finding({
            ruleId: "A",
            category: "COMPATIBILITY_PHP",
            severity: "HIGH",
            status: "CONFIRMED_COMPATIBILITY",
            title: `Plugin "${p.name}" requires PHP ${p.requiresPHP}, but the site runs PHP ${n.phpVersion}`,
            description: `The plugin header declares a minimum PHP version of ${p.requiresPHP}. The site reports PHP ${n.phpVersion}, which is below that minimum. This is a compatibility mismatch; it does not by itself prove any specific error or crash.`,
            evidence: { declared: { requiresPHP: p.requiresPHP }, observed: { phpVersion: n.phpVersion } },
            referencedItems: [itemRef("plugin", p)],
            recommendation: "Do not change the live site directly. On a staging copy, upgrade PHP to at least the required version or replace the plugin, then re-test the reported symptom.",
            confidence: "HIGH",
            requiredAdditionalEvidence: null,
          }));
        }
      }
      if (p.requiresWP !== null) {
        const below = isBelowMinimum(n.wordpressVersion, p.requiresWP);
        if (below === null) skip("B", `Plugin "${p.name}" WordPress requirement "${p.requiresWP}" or site WordPress version "${n.wordpressVersion}" is malformed; comparison skipped.`);
        else if (below) {
          findings.push(finding({
            ruleId: "B",
            category: "COMPATIBILITY_WP",
            severity: "HIGH",
            status: "CONFIRMED_COMPATIBILITY",
            title: `Plugin "${p.name}" requires WordPress ${p.requiresWP}, but the site runs WordPress ${n.wordpressVersion}`,
            description: `The plugin header declares a minimum WordPress version of ${p.requiresWP}. The site reports WordPress ${n.wordpressVersion}, which is below that minimum. This is a compatibility mismatch; it does not by itself prove any specific error or crash.`,
            evidence: { declared: { requiresWP: p.requiresWP }, observed: { wordpressVersion: n.wordpressVersion } },
            referencedItems: [itemRef("plugin", p)],
            recommendation: "Do not change the live site directly. On a staging copy, update WordPress to at least the required version or replace the plugin, then re-test the reported symptom.",
            confidence: "HIGH",
            requiredAdditionalEvidence: null,
          }));
        }
      }
    }

    // ---- Rule C (declared dependencies, WP 6.5+ "Requires Plugins" only) ----
    const bySlug = new Map();
    for (const p of n.plugins) if (p.slug && !bySlug.has(p.slug)) bySlug.set(p.slug, p);
    for (const p of n.plugins) {
      if (!p.active) continue;
      for (const dep of p.dependencies) {
        const target = bySlug.get(dep);
        if (!target) {
          findings.push(finding({
            ruleId: "C",
            category: "DEPENDENCY",
            severity: "MEDIUM",
            status: "CONFIRMED_COMPATIBILITY",
            title: `Plugin "${p.name}" declares a dependency on "${dep}", which is not installed`,
            description: `The plugin header declares "Requires Plugins: ${dep}" (or a list containing it), but no installed plugin with that slug appears in the snapshot. A missing declared dependency can break the features that rely on it; this does not prove it caused the reported symptom.`,
            evidence: { declared: { dependencies: p.dependencies }, observed: { installedSlugs: [...bySlug.keys()] } },
            referencedItems: [itemRef("plugin", p), { kind: "plugin", name: null, slug: dep, version: null }],
            recommendation: "On a staging copy, install the declared dependency from a trusted source and re-test, or replace the dependent plugin. Do not install plugins on the live site without a backup.",
            confidence: "HIGH",
            requiredAdditionalEvidence: null,
          }));
        } else if (!target.active) {
          findings.push(finding({
            ruleId: "C",
            category: "DEPENDENCY",
            severity: "MEDIUM",
            status: "POTENTIAL",
            title: `Plugin "${p.name}" declares a dependency on "${dep}", which is installed but inactive`,
            description: `The plugin header declares a dependency on "${dep}". That plugin is installed but not active, so the features that rely on it may not work. This does not prove it caused the reported symptom.`,
            evidence: { declared: { dependencies: p.dependencies }, observed: { dependency: { name: target.name, slug: dep, active: false } } },
            referencedItems: [itemRef("plugin", p), itemRef("plugin", target)],
            recommendation: "On a staging copy, activate the dependency and re-test the reported symptom. Do not activate plugins on the live site without a backup.",
            confidence: "MEDIUM",
            requiredAdditionalEvidence: "Whether the reported symptom changes with the dependency active on staging.",
          }));
        }
      }
    }

    // ---- Rule E (cached update available — never a vulnerability claim) ----
    for (const p of n.plugins) {
      if (!p.active || !p.updateAvailable) continue;
      findings.push(finding({
        ruleId: "E",
        category: "UPDATE",
        severity: "LOW",
        status: "POTENTIAL",
        title: `An update is available for plugin "${p.name}"${p.newVersion ? ` (version ${p.newVersion})` : ""}`,
        description: "WordPress's cached update data reports a newer version. This is an update notice only: it is NOT a claim that the installed version is vulnerable, broken, or the cause of the reported symptom. Update information comes from the cached update check and may be stale.",
        evidence: { declared: null, observed: { installedVersion: p.version, newVersion: p.newVersion, updateCheckedAt: p.updateCheckedAt } },
        referencedItems: [itemRef("plugin", p)],
        recommendation: "Review the update changelog, back up the site, and test the update on a staging copy before updating the live site.",
        confidence: p.newVersion ? "HIGH" : "MEDIUM",
        requiredAdditionalEvidence: null,
      }));
    }
  }

  // ---- Rule F (theme compatibility + parent-theme distinction) ----
  if (n.theme) {
    const t = n.theme;
    if (n.schemaVersion === 2) {
      if (t.requiresPHP !== null) {
        const below = isBelowMinimum(n.phpVersion, t.requiresPHP);
        if (below === null) skip("F", `Theme "${t.name}" PHP requirement "${t.requiresPHP}" or site PHP version "${n.phpVersion}" is malformed; comparison skipped.`);
        else if (below) {
          findings.push(finding({
            ruleId: "F",
            category: "THEME",
            severity: "HIGH",
            status: "CONFIRMED_COMPATIBILITY",
            title: `Theme "${t.name}" requires PHP ${t.requiresPHP}, but the site runs PHP ${n.phpVersion}`,
            description: `The theme header declares a minimum PHP version of ${t.requiresPHP}. The site reports PHP ${n.phpVersion}, which is below that minimum. This is a compatibility mismatch; it does not by itself prove any specific error or layout problem.`,
            evidence: { declared: { requiresPHP: t.requiresPHP }, observed: { phpVersion: n.phpVersion } },
            referencedItems: [{ kind: "theme", name: t.name, slug: null, version: t.version }],
            recommendation: "Do not change the live site directly. On a staging copy, upgrade PHP to at least the required version or switch to a compatible theme, then re-test.",
            confidence: "HIGH",
            requiredAdditionalEvidence: null,
          }));
        }
      }
      if (t.requiresWP !== null) {
        const below = isBelowMinimum(n.wordpressVersion, t.requiresWP);
        if (below === null) skip("F", `Theme "${t.name}" WordPress requirement "${t.requiresWP}" or site WordPress version "${n.wordpressVersion}" is malformed; comparison skipped.`);
        else if (below) {
          findings.push(finding({
            ruleId: "F",
            category: "THEME",
            severity: "HIGH",
            status: "CONFIRMED_COMPATIBILITY",
            title: `Theme "${t.name}" requires WordPress ${t.requiresWP}, but the site runs WordPress ${n.wordpressVersion}`,
            description: `The theme header declares a minimum WordPress version of ${t.requiresWP}. The site reports WordPress ${n.wordpressVersion}, which is below that minimum. This is a compatibility mismatch; it does not by itself prove any specific error or layout problem.`,
            evidence: { declared: { requiresWP: t.requiresWP }, observed: { wordpressVersion: n.wordpressVersion } },
            referencedItems: [{ kind: "theme", name: t.name, slug: null, version: t.version }],
            recommendation: "Do not change the live site directly. On a staging copy, update WordPress to at least the required version or switch to a compatible theme, then re-test.",
            confidence: "HIGH",
            requiredAdditionalEvidence: null,
          }));
        }
      }
      // Parent-theme distinction: a child theme's parent is reported, not
      // blamed. A parent name with no parent version is missing data.
      if (t.parentName !== null && t.parentVersion === null) {
        findings.push(finding({
          ruleId: "F",
          category: "THEME",
          severity: "LOW",
          status: "INSUFFICIENT_EVIDENCE",
          title: `Theme "${t.name}" is a child theme of "${t.parentName}", but the parent version is unknown`,
          description: "The active theme is a child theme. Its parent theme name is known but the parent version could not be read, so parent-theme compatibility cannot be checked. The parent theme is not identified as a cause.",
          evidence: { declared: null, observed: { theme: t.name, parentName: t.parentName, parentVersion: null } },
          referencedItems: [{ kind: "theme", name: t.name, slug: null, version: t.version }, { kind: "theme", name: t.parentName, slug: null, version: null }],
          recommendation: "Note the parent theme separately from the child theme when reporting the issue, and sync a fresh snapshot.",
          confidence: "LOW",
          requiredAdditionalEvidence: "The parent theme version.",
        }));
      }
    } else {
      skip("F", "Extended snapshot required: theme requirements and parent-theme data are not present in a v1 snapshot.");
    }
  }

  // ---- Rule G (symptom context only — never causal) ----
  const category = typeof symptom?.category === "string" ? symptom.category : "UNKNOWN";
  const description = typeof symptom?.description === "string" ? symptom.description : "";
  if (category !== "UNKNOWN" || description.trim().length > 0) {
    findings.push(finding({
      ruleId: "G",
      category: "SYMPTOM_CONTEXT",
      severity: "LOW",
      status: "INSUFFICIENT_EVIDENCE",
      title: "Reported symptom recorded as context only",
      description: "The symptom below was reported by the user. It describes what was observed; it does not identify a cause, and a symptom that appeared after an update does not prove the update caused it. No plugin, theme, or update is blamed on the basis of this symptom alone.",
      evidence: { declared: null, observed: { symptomCategory: category, hasDescription: description.trim().length > 0 } },
      referencedItems: [],
      recommendation: "Use the compatibility and dependency findings above to decide what to test on staging; record the exact page or feature affected and the exact error text if available.",
      confidence: "LOW",
      requiredAdditionalEvidence: "The exact affected page or feature and the exact error text, plus whether the symptom reproduces on staging.",
    }));
  }

  // ---- Rule H (insufficient evidence) ----
  if (n.schemaVersion === 1) {
    findings.push(finding({
      ruleId: "H",
      category: "EVIDENCE",
      severity: "MEDIUM",
      status: "INSUFFICIENT_EVIDENCE",
      title: "Extended snapshot required for full plugin and theme checks",
      description: "This diagnostic ran against a v1 snapshot, which contains only active plugin names/versions and the active theme name/version. PHP/WordPress requirements, declared dependencies, update information, and parent-theme data are absent, so Rules A, B, C, E, and theme checks could not run. Their absence is missing data, not a clean bill of health.",
      evidence: { declared: null, observed: { snapshotSchemaVersion: 1 } },
      referencedItems: [],
      recommendation: "Update the connector plugin to version 1.1.0 or later, sync a fresh diagnostic snapshot from the WordPress connector admin page, then re-run this check.",
      confidence: "HIGH",
      requiredAdditionalEvidence: "A v2 snapshot from connector plugin 1.1.0+.",
    }));
  } else {
    const anyRequires = n.plugins.some((p) => p.requiresWP !== null || p.requiresPHP !== null) || n.theme?.requiresWP !== null || n.theme?.requiresPHP !== null;
    const anyUpdateInfo = n.plugins.some((p) => p.updateCheckedAt !== null);
    if (!anyRequires) {
      findings.push(finding({
        ruleId: "H",
        category: "EVIDENCE",
        severity: "LOW",
        status: "INSUFFICIENT_EVIDENCE",
        title: "No PHP or WordPress requirement metadata was available",
        description: "No installed plugin or theme in this snapshot declares a minimum PHP or WordPress version, so compatibility checks had nothing to compare against. This means the checks could not run, not that everything is compatible.",
        evidence: { declared: null, observed: { snapshotSchemaVersion: 2, pluginCount: n.plugins.length } },
        referencedItems: [],
        recommendation: "If a plugin or theme is suspected, check its header requirements manually and compare them with the site versions shown in this report.",
        confidence: "MEDIUM",
        requiredAdditionalEvidence: "Plugin/theme header requirements.",
      }));
    }
    if (!anyUpdateInfo) {
      findings.push(finding({
        ruleId: "H",
        category: "EVIDENCE",
        severity: "LOW",
        status: "INSUFFICIENT_EVIDENCE",
        title: "Cached update information was unavailable or stale",
        description: "The snapshot carries no update-check timestamp, so update availability could not be confirmed. No update finding was invented from this absence.",
        evidence: { declared: null, observed: { snapshotSchemaVersion: 2 } },
        referencedItems: [],
        recommendation: "Check Updates in the WordPress admin directly; do not rely on this report for update status.",
        confidence: "MEDIUM",
        requiredAdditionalEvidence: "A snapshot taken after WordPress's cached update check has run.",
      }));
    }
  }
  if (skipped.length > 0 && n.schemaVersion === 2) {
    findings.push(finding({
      ruleId: "H",
      category: "EVIDENCE",
      severity: "LOW",
      status: "INSUFFICIENT_EVIDENCE",
      title: "Some checks were skipped because version data was malformed",
      description: "One or more version comparisons were skipped because a declared or observed version string could not be parsed. Skipped checks are listed in the evidence; they were not approximated.",
      evidence: { declared: null, observed: { skipped } },
      referencedItems: [],
      recommendation: "Correct the malformed version in the plugin or theme header, sync a fresh snapshot, then re-run this check.",
      confidence: "MEDIUM",
      requiredAdditionalEvidence: "Parseable version strings for the skipped items.",
    }));
  }

  return { findings, skipped };
}

// Convenience: does any finding claim a confirmed conflict between two
// plugins? By construction the engine never produces one; tests assert this.
export function hasConfirmedPluginConflict(findings) {
  return findings.some((f) => f.status === "CONFIRMED_COMPATIBILITY" && f.category === "PLUGIN_CONFLICT");
}

export { compareVersions };
