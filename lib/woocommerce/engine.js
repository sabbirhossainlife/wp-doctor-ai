// Deterministic WooCommerce Checkout & Payment Diagnostics (Milestone 7).
// Pure functions over a stored connector snapshot + user-reported symptoms.
// No AI, no network, no site modification, no payment execution, no order
// inspection. Hard invariants:
//  - An enabled gateway does NOT prove a payment will succeed.
//  - A configured checkout page does NOT prove a real checkout works.
//  - Enabled does NOT mean block-compatible.
//  - A user symptom is NEVER a verified fact (Rule I context only).
//  - Absent WooCommerce fields in a legacy (v1/v2) snapshot mean UNKNOWN /
//    INSUFFICIENT_EVIDENCE — NEVER "WooCommerce disabled" (Rule K).
//  - Block compatibility is trusted ONLY when explicitly declared
//    (blockCompatibilitySource === "declared"); UNKNOWN is never a failure.
//  - Classic checkout is NEVER recommended as a universal fix; nothing is
//    switched, enabled, or changed by this tool.
//  - No orders, customers, transactions, credentials, or secrets are ever
//    read, so no finding ever claims a payment outcome, an order status,
//    or credential validity.
//
// Finding vocabulary (Tool 02 literals, used consistently):
//   CONFIRMED_COMPATIBILITY | POTENTIAL | INSUFFICIENT_EVIDENCE
// Rules: A WooCommerce missing/inactive; B missing page assignment;
//   C assigned page missing/unpublished; D same page for multiple roles;
//   E block vs classic compatibility; F no gateways enabled;
//   G enabled gateway, unknown block compatibility; H WooCommerce
//   version requirements vs site versions; I symptom context only;
//   J pending/failed payment reports (no order inspection);
//   K missing information.

import { isBelowMinimum } from "../conflict/versions.js";

export const FINDING_STATUSES = ["CONFIRMED_COMPATIBILITY", "POTENTIAL", "INSUFFICIENT_EVIDENCE"];

const PAGE_ROLES = ["cart", "checkout", "myAccount"];
const PAGE_LABEL = { cart: "Cart", checkout: "Checkout", myAccount: "My Account" };
const WOO_STATUSES = new Set(["AVAILABLE", "NOT_INSTALLED", "INACTIVE", "UNKNOWN"]);
const BLOCK_COMPATS = new Set(["SUPPORTED", "UNSUPPORTED", "UNKNOWN"]);
const PAYMENT_OUTCOME_CATEGORIES = new Set(["ORDER_PENDING", "PAYMENT_DECLINED_OR_FAILED", "PAYMENT_INIT_ERROR"]);

function boundedString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function normalizeWooSnapshot(snapshot) {
  const s = snapshot && typeof snapshot === "object" ? snapshot : {};
  const schemaVersion = s.schemaVersion === 3 ? 3 : s.schemaVersion === 2 ? 2 : 1;
  const rawWoo = s.schemaVersion === 3 && s.woocommerce && typeof s.woocommerce === "object" ? s.woocommerce : null;
  let woo = null;
  if (rawWoo) {
    const pages = {};
    for (const role of PAGE_ROLES) {
      const p = rawWoo.pages && typeof rawWoo.pages === "object" ? rawWoo.pages[role] : null;
      if (!p || typeof p !== "object") { pages[role] = null; continue; }
      pages[role] = {
        pageId: Number.isInteger(p.pageId) && p.pageId > 0 ? p.pageId : null,
        exists: p.exists === true,
        status: typeof p.status === "string" ? p.status : "unknown",
        implementation: typeof p.implementation === "string" ? p.implementation : "unknown",
      };
    }
    woo = {
      installed: rawWoo.installed === true,
      active: rawWoo.active === true,
      version: boundedString(rawWoo.version),
      status: WOO_STATUSES.has(rawWoo.status) ? rawWoo.status : "UNKNOWN",
      pages,
      gateways: Array.isArray(rawWoo.gateways)
        ? rawWoo.gateways.filter((g) => g && typeof g === "object" && typeof g.id === "string" && g.id).map((g) => ({
            id: g.id,
            title: boundedString(g.title) ?? g.id,
            enabled: g.enabled === true,
            available: g.available === true ? true : g.available === false ? false : null,
            blockCompatibility: BLOCK_COMPATS.has(g.blockCompatibility) ? g.blockCompatibility : "UNKNOWN",
            blockCompatibilitySource: g.blockCompatibilitySource === "declared" ? "declared" : "not-determined",
          }))
        : [],
    };
  }
  const plugins = Array.isArray(s.plugins)
    ? s.plugins.filter((p) => p && typeof p === "object")
    : [];
  const wooPlugin = plugins.find((p) => p.slug === "woocommerce") ?? null;
  return {
    schemaVersion,
    wordpressVersion: boundedString(s.wordpressVersion),
    phpVersion: boundedString(s.phpVersion),
    woo,
    wooPlugin: wooPlugin
      ? {
          version: boundedString(wooPlugin.version),
          requiresWP: boundedString(wooPlugin.requiresWP),
          requiresPHP: boundedString(wooPlugin.requiresPHP),
        }
      : null,
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

function gatewayRef(g) {
  return { kind: "gateway", name: g.title, slug: g.id, version: null };
}

function pageRef(role, page) {
  return { kind: "page", name: `${PAGE_LABEL[role]} page`, slug: page?.pageId != null ? String(page.pageId) : null, version: null };
}

// symptom: { category, description, checkoutType, affectedScope } —
// user-reported, untrusted context. Returns { findings, skipped }.
export function runWooRules(snapshot, symptom = {}) {
  const n = normalizeWooSnapshot(snapshot);
  const findings = [];
  const skipped = [];
  const woo = n.woo;
  const checkout = woo?.pages?.checkout ?? null;

  // ---- Rule A: WooCommerce missing / inactive (explicit v3 state only) ----
  if (woo && woo.status === "NOT_INSTALLED") {
    findings.push(finding({
      ruleId: "A", category: "WOOCOMMERCE_PRESENCE", severity: "HIGH", status: "CONFIRMED_COMPATIBILITY",
      title: "WooCommerce is not installed on this site",
      description: "The snapshot inventory contains no WooCommerce plugin. Checkout and payment checks cannot run because there is no store to check. This is a statement about the snapshot inventory, not about any other site.",
      evidence: { declared: null, observed: { woocommerceStatus: "NOT_INSTALLED" } },
      referencedItems: [{ kind: "plugin", name: "WooCommerce", slug: "woocommerce", version: null }],
      recommendation: "If this site should be a store, install WooCommerce from a trusted source on a staging copy first, then sync a fresh snapshot and re-run this check. Do not install plugins on the live site without a backup.",
      confidence: "HIGH",
    }));
  } else if (woo && woo.status === "INACTIVE") {
    findings.push(finding({
      ruleId: "A", category: "WOOCOMMERCE_PRESENCE", severity: "HIGH", status: "CONFIRMED_COMPATIBILITY",
      title: "WooCommerce is installed but inactive on this site",
      description: "The snapshot inventory lists WooCommerce as installed but not active. With WooCommerce inactive, its checkout pages and payment gateways are not operating. This does not identify why it was deactivated.",
      evidence: { declared: null, observed: { woocommerceStatus: "INACTIVE", version: woo.version } },
      referencedItems: [{ kind: "plugin", name: "WooCommerce", slug: "woocommerce", version: woo.version }],
      recommendation: "On a staging copy, activate WooCommerce and re-test checkout, then sync a fresh snapshot and re-run this check. Do not activate plugins on the live site without a backup.",
      confidence: "HIGH",
    }));
  }

  // Page + gateway rules run only when WooCommerce is AVAILABLE. When it is
  // missing/inactive, Rule A is the finding; when its state is UNKNOWN,
  // Rule K says so instead of guessing at page/gateway configuration.
  if (woo && woo.status === "AVAILABLE") {
    // ---- Rule B: missing page assignment ----
    for (const role of PAGE_ROLES) {
      const page = woo.pages[role];
      if (!page || page.pageId === null) {
        findings.push(finding({
          ruleId: "B", category: "PAGE_CONFIGURATION", severity: role === "checkout" ? "HIGH" : "MEDIUM", status: "CONFIRMED_COMPATIBILITY",
          title: `No ${PAGE_LABEL[role]} page is assigned`,
          description: `WooCommerce has no page assigned as the ${PAGE_LABEL[role]} page in its settings. Customers reaching ${PAGE_LABEL[role].toLowerCase()} functionality have no configured page to land on. This is a configuration fact from the snapshot; it does not prove any specific checkout failure.`,
          evidence: { declared: null, observed: { role, pageId: null } },
          referencedItems: [pageRef(role, null)],
          recommendation: "Manually assign a published page in WooCommerce settings (page setup), on staging first if the store is live, then sync a fresh snapshot and re-run this check. This app does not change the assignment.",
          confidence: "HIGH",
        }));
      }
    }

    // ---- Rule C: assigned page missing / unpublished / status unknown ----
    for (const role of PAGE_ROLES) {
      const page = woo.pages[role];
      if (!page || page.pageId === null) continue;
      if (!page.exists) {
        findings.push(finding({
          ruleId: "C", category: "PAGE_CONFIGURATION", severity: role === "checkout" ? "HIGH" : "MEDIUM", status: "CONFIRMED_COMPATIBILITY",
          title: `The assigned ${PAGE_LABEL[role]} page (id ${page.pageId}) was not found`,
          description: "The page id stored in WooCommerce settings does not resolve to a page on the site. It may have been deleted, or the stored id may be invalid; the snapshot cannot distinguish deleted from otherwise inaccessible, and this finding claims neither. A missing checkout page means checkout has no page to render on.",
          evidence: { declared: null, observed: { role, pageId: page.pageId, exists: false } },
          referencedItems: [pageRef(role, page)],
          recommendation: "Manually assign an existing published page in WooCommerce settings, then sync a fresh snapshot and re-run this check. This app does not change the assignment.",
          confidence: "HIGH",
        }));
      } else if (["draft", "trash", "private"].includes(page.status)) {
        findings.push(finding({
          ruleId: "C", category: "PAGE_CONFIGURATION", severity: role === "checkout" ? "HIGH" : "MEDIUM", status: "CONFIRMED_COMPATIBILITY",
          title: `The assigned ${PAGE_LABEL[role]} page (id ${page.pageId}) is not published (status: ${page.status})`,
          description: `The assigned page exists but its status is "${page.status}", so visitors cannot reach it as a normal published page. This is a configuration fact; it does not by itself prove the reported symptom.`,
          evidence: { declared: null, observed: { role, pageId: page.pageId, exists: true, status: page.status } },
          referencedItems: [pageRef(role, page)],
          recommendation: "Manually publish the assigned page (or assign a different published page) in WooCommerce settings, then sync a fresh snapshot and re-run this check.",
          confidence: "HIGH",
        }));
      } else if (page.status === "unknown") {
        findings.push(finding({
          ruleId: "C", category: "PAGE_CONFIGURATION", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
          title: `The assigned ${PAGE_LABEL[role]} page (id ${page.pageId}) has an unknown status`,
          description: "The assigned page exists, but its publish status could not be determined from the snapshot. Whether visitors can reach it is therefore unknown, not assumed.",
          evidence: { declared: null, observed: { role, pageId: page.pageId, exists: true, status: "unknown" } },
          referencedItems: [pageRef(role, page)],
          recommendation: "Check the page status manually in WordPress (Pages), then sync a fresh snapshot and re-run this check.",
          confidence: "LOW",
          requiredAdditionalEvidence: "The page's publish status from the WordPress admin.",
        }));
      }
    }

    // ---- Rule D: same page assigned to multiple roles (official docs) ----
    const byPageId = new Map();
    for (const role of PAGE_ROLES) {
      const page = woo.pages[role];
      if (page && page.pageId !== null) {
        if (!byPageId.has(page.pageId)) byPageId.set(page.pageId, []);
        byPageId.get(page.pageId).push(role);
      }
    }
    for (const [pageId, roles] of byPageId.entries()) {
      if (roles.length < 2) continue;
      const labels = roles.map((r) => PAGE_LABEL[r]).join(" and ");
      findings.push(finding({
        ruleId: "D", category: "PAGE_CONFIGURATION", severity: "HIGH", status: "CONFIRMED_COMPATIBILITY",
        title: `The same page (id ${pageId}) is assigned to ${labels}`,
        description: "WooCommerce documentation states that setting the Cart, Checkout, and My Account pages to the same page causes incorrect redirects and broken payment gateway functionality. This finding reports that configuration; it does not claim a specific redirect or payment failure was observed.",
        evidence: { declared: null, observed: { pageId, roles } },
        referencedItems: roles.map((r) => pageRef(r, woo.pages[r])),
        recommendation: "Manually assign a different published page to each role in WooCommerce settings, then sync a fresh snapshot and re-run this check. This app does not change page assignments.",
        confidence: "HIGH",
      }));
    }

    const checkoutImpl = checkout?.implementation ?? "unknown";
    // ---- Rule E: block vs classic compatibility (explicit evidence only) ----
    for (const g of woo.gateways) {
      if (!g.enabled) continue;
      if (g.blockCompatibility === "UNSUPPORTED" && g.blockCompatibilitySource === "declared") {
        if (checkoutImpl === "block") {
          findings.push(finding({
            ruleId: "E", category: "BLOCK_COMPATIBILITY", severity: "MEDIUM", status: "CONFIRMED_COMPATIBILITY",
            title: `Gateway "${g.title}" declares it does not support the Checkout block`,
            description: "The gateway's declared block compatibility is UNSUPPORTED and the checkout page uses the Checkout block. This is a declared incompatibility, not a proven payment failure: the gateway may still behave differently in practice, and this tool never runs a payment to find out. Switching to classic checkout is NOT recommended as a universal fix — check the gateway's documentation first.",
            evidence: { declared: { blockCompatibility: "UNSUPPORTED", source: "declared" }, observed: { gatewayId: g.id, checkoutImplementation: "block" } },
            referencedItems: [gatewayRef(g)],
            recommendation: "Check the gateway provider's documentation for Checkout block support, and test checkout on staging. Do not switch the live checkout implementation without a backup and a staging test.",
            confidence: "HIGH",
          }));
        } else if (checkoutImpl === "unknown") {
          findings.push(finding({
            ruleId: "E", category: "BLOCK_COMPATIBILITY", severity: "MEDIUM", status: "POTENTIAL",
            title: `Gateway "${g.title}" declares it does not support the Checkout block, but the checkout implementation is unknown`,
            description: "The gateway's declared block compatibility is UNSUPPORTED. Whether this matters depends on whether the checkout page uses the Checkout block, which could not be classified from the snapshot, so this is a possible issue, not a confirmed one.",
            evidence: { declared: { blockCompatibility: "UNSUPPORTED", source: "declared" }, observed: { gatewayId: g.id, checkoutImplementation: "unknown" } },
            referencedItems: [gatewayRef(g)],
            recommendation: "Check whether the checkout page uses the Checkout block, check the gateway provider's documentation, and test on staging.",
            confidence: "MEDIUM",
            requiredAdditionalEvidence: "The checkout page implementation (block or classic shortcode).",
          }));
        }
        // Classic checkout: block compatibility is irrelevant — no finding.
      } else if (g.blockCompatibility === "UNSUPPORTED") {
        // Declared-ness missing: treat as possible, never confirmed.
        if (checkoutImpl === "block") {
          findings.push(finding({
            ruleId: "E", category: "BLOCK_COMPATIBILITY", severity: "LOW", status: "POTENTIAL",
            title: `Gateway "${g.title}" is recorded as block-incompatible, but the declaration source is not trustworthy`,
            description: "The snapshot records this gateway as block-incompatible without a trustworthy declaration source, so this is treated as a possible issue only. It is not presented as a confirmed incompatibility.",
            evidence: { declared: { blockCompatibility: "UNSUPPORTED", source: g.blockCompatibilitySource }, observed: { gatewayId: g.id, checkoutImplementation: "block" } },
            referencedItems: [gatewayRef(g)],
            recommendation: "Verify block support in the gateway provider's documentation and test checkout on staging.",
            confidence: "LOW",
            requiredAdditionalEvidence: "A trustworthy declaration of the gateway's Checkout block support.",
          }));
        }
      }
    }

    // ---- Rule F: no gateways enabled ----
    const enabled = woo.gateways.filter((g) => g.enabled);
    if (enabled.length === 0) {
      findings.push(finding({
        ruleId: "F", category: "PAYMENT_GATEWAYS", severity: "MEDIUM", status: "POTENTIAL",
        title: "No payment gateway is enabled",
        description: `No registered gateway is enabled in this snapshot${woo.gateways.length === 0 ? " (the registered gateway list itself is empty)" : ""}. Customers at checkout would see no payment method from WooCommerce's enabled set. This is not automatically a payment-system failure: manual or external payment workflows outside WooCommerce's gateway list may exist, and this tool does not inspect them. Conversely, an enabled gateway would not prove a payment will succeed.`,
        evidence: { declared: null, observed: { registeredGatewayCount: woo.gateways.length, enabledGatewayCount: 0 } },
        referencedItems: [],
        recommendation: "Manually review WooCommerce > Settings > Payments: enable and configure at least one gateway for the store's customers, then sync a fresh snapshot and re-run this check. This app does not enable or configure gateways.",
        confidence: "MEDIUM",
        requiredAdditionalEvidence: "Whether any manual or external payment workflow exists outside the registered gateways.",
      }));
    }

    // ---- Rule G: enabled gateway, unknown block compatibility ----
    if (checkoutImpl === "block" || checkoutImpl === "unknown") {
      for (const g of enabled) {
        if (g.blockCompatibility !== "UNKNOWN") continue;
        findings.push(finding({
          ruleId: "G", category: "BLOCK_COMPATIBILITY", severity: "LOW",
          status: checkoutImpl === "block" ? "POTENTIAL" : "INSUFFICIENT_EVIDENCE",
          title: `Gateway "${g.title}" block compatibility is unknown`,
          description: checkoutImpl === "block"
            ? "This gateway is enabled and the checkout page uses the Checkout block, but the snapshot carries no trustworthy declaration of whether the gateway supports the block. Unknown compatibility is a warning to verify, not a failure: the gateway may work fine, and this tool never runs a payment to find out."
            : "This gateway is enabled, but the snapshot carries no trustworthy declaration of its Checkout block support and the checkout implementation itself is unknown, so block compatibility cannot be assessed.",
          evidence: { declared: null, observed: { gatewayId: g.id, checkoutImplementation: checkoutImpl, blockCompatibility: "UNKNOWN" } },
          referencedItems: [gatewayRef(g)],
          recommendation: "Check the gateway provider's documentation for Checkout block support and test checkout on staging.",
          confidence: "LOW",
          requiredAdditionalEvidence: "A trustworthy declaration of the gateway's Checkout block support.",
        }));
      }
    }

    // ---- Rule H: WooCommerce version requirements vs site versions ----
    if (n.wooPlugin) {
      const checks = [
        ["requiresPHP", n.phpVersion, "PHP"],
        ["requiresWP", n.wordpressVersion, "WordPress"],
      ];
      for (const [field, observed, label] of checks) {
        const required = n.wooPlugin[field];
        if (required === null) continue;
        const below = isBelowMinimum(observed, required);
        if (below === null) {
          skipped.push({ ruleId: "H", reason: `WooCommerce ${field} "${required}" or site ${label} version "${observed}" is malformed; comparison skipped.` });
        } else if (below) {
          findings.push(finding({
            ruleId: "H", category: "COMPATIBILITY_VERSION", severity: "HIGH", status: "CONFIRMED_COMPATIBILITY",
            title: `WooCommerce requires ${label} ${required}, but the site runs ${label} ${observed}`,
            description: `The WooCommerce plugin header declares a minimum ${label} version of ${required}. The site reports ${label} ${observed}, which is below that minimum. This is a compatibility mismatch; it is not by itself a confirmed runtime failure.`,
            evidence: { declared: { [field]: required }, observed: { [`${label.toLowerCase()}Version`]: observed } },
            referencedItems: [{ kind: "plugin", name: "WooCommerce", slug: "woocommerce", version: n.wooPlugin.version }],
            recommendation: "Do not change the live site directly. On a staging copy, upgrade to at least the required version or replace the component, then re-test checkout.",
            confidence: "HIGH",
          }));
        }
      }
    }
  }

  // ---- Rule I: symptom as untrusted context only ----
  const category = typeof symptom?.category === "string" ? symptom.category : "UNKNOWN";
  const description = typeof symptom?.description === "string" ? symptom.description : "";
  if (category !== "UNKNOWN" || description.trim().length > 0) {
    findings.push(finding({
      ruleId: "I", category: "SYMPTOM_CONTEXT", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
      title: "Reported symptom recorded as context only",
      description: "The symptom below was reported by the user. It describes what was observed; it does not identify a cause, and it is not treated as a verified fact. No gateway, page, or version is blamed on the basis of this symptom alone. The checkout type and scope below, if given, are also user-reported only.",
      evidence: { declared: null, observed: { symptomCategory: category, hasDescription: description.trim().length > 0, checkoutTypeReported: typeof symptom?.checkoutType === "string" ? symptom.checkoutType : null, affectedScopeReported: typeof symptom?.affectedScope === "string" ? symptom.affectedScope : null } },
      referencedItems: [],
      recommendation: "Use the configuration findings above to decide what to test on staging; record the exact checkout step and the exact customer-facing message if available.",
      confidence: "LOW",
      requiredAdditionalEvidence: "The exact checkout step affected, the exact customer-facing message, and whether the symptom reproduces on staging.",
    }));
  }

  // ---- Rule J: pending / failed payment reports — no order inspection ----
  if (PAYMENT_OUTCOME_CATEGORIES.has(category)) {
    findings.push(finding({
      ruleId: "J", category: "PAYMENT_OUTCOME", severity: "MEDIUM", status: "INSUFFICIENT_EVIDENCE",
      title: "Payment outcome cannot be verified from this snapshot",
      description: "This tool inspects store configuration only: it never reads orders, transactions, gateway dashboards, or webhook state, so it cannot confirm whether a payment succeeded, failed, or is still pending, and it makes no such claim. The reported category is user-reported context, not transaction evidence.",
      evidence: { declared: null, observed: { symptomCategory: category, ordersInspected: false, transactionsInspected: false } },
      referencedItems: [],
      recommendation: "Authorized manual investigation only: with merchant access, check the payment provider's dashboard and the WooCommerce order record for the affected order, and confirm the transaction status there. This app does not perform that investigation or change any order.",
      confidence: "MEDIUM",
      requiredAdditionalEvidence: "The transaction/order status from the payment provider's dashboard, obtained by an authorized merchant.",
    }));
  }

  // ---- Rule K: missing information ----
  if (!woo) {
    findings.push(finding({
      ruleId: "K", category: "EVIDENCE", severity: "MEDIUM", status: "INSUFFICIENT_EVIDENCE",
      title: "WooCommerce data is not available in this snapshot",
      description: `This diagnostic ran against a schema v${n.schemaVersion} snapshot, which predates the WooCommerce section. WooCommerce presence, page assignments, and gateways are therefore unknown. Their absence is missing data — it is NEVER a claim that WooCommerce is disabled, missing, or misconfigured.`,
      evidence: { declared: null, observed: { snapshotSchemaVersion: n.schemaVersion } },
      referencedItems: [],
      recommendation: "Update the connector plugin to version 1.2.0 or later, sync a fresh diagnostic snapshot from the WordPress connector admin page, then re-run this check.",
      confidence: "HIGH",
      requiredAdditionalEvidence: "A v3 snapshot from connector plugin 1.2.0+.",
    }));
  } else {
    if (woo.status === "UNKNOWN") {
      findings.push(finding({
        ruleId: "K", category: "EVIDENCE", severity: "MEDIUM", status: "INSUFFICIENT_EVIDENCE",
        title: "WooCommerce presence could not be determined",
        description: "The snapshot carries a WooCommerce section, but its status is UNKNOWN, so presence, page, and gateway checks could not run. Unknown is reported as unknown, not as disabled.",
        evidence: { declared: null, observed: { woocommerceStatus: "UNKNOWN" } },
        referencedItems: [],
        recommendation: "Sync a fresh diagnostic snapshot from the WordPress connector admin page, then re-run this check.",
        confidence: "MEDIUM",
        requiredAdditionalEvidence: "A fresh v3 snapshot with a determined WooCommerce status.",
      }));
    }
    if (woo.status === "AVAILABLE" && woo.version === null) {
      findings.push(finding({
        ruleId: "K", category: "EVIDENCE", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
        title: "WooCommerce version is unknown",
        description: "WooCommerce is available, but its version could not be read from the snapshot, so version-dependent checks are limited. No version is assumed.",
        evidence: { declared: null, observed: { woocommerceStatus: "AVAILABLE", version: null } },
        referencedItems: [{ kind: "plugin", name: "WooCommerce", slug: "woocommerce", version: null }],
        recommendation: "Check the installed WooCommerce version in WordPress (Plugins), then sync a fresh snapshot and re-run this check.",
        confidence: "LOW",
        requiredAdditionalEvidence: "The installed WooCommerce version.",
      }));
    }
    if (woo.status === "AVAILABLE" && checkout && checkout.exists && checkout.implementation === "unknown") {
      findings.push(finding({
        ruleId: "K", category: "EVIDENCE", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
        title: "Checkout page implementation could not be classified",
        description: "The assigned checkout page exists, but its content carries neither the Checkout block nor the classic checkout shortcode signal, so the implementation (block vs classic) is unknown. Block-compatibility findings that depend on it are therefore limited.",
        evidence: { declared: null, observed: { checkoutPageId: checkout.pageId, implementation: "unknown" } },
        referencedItems: [pageRef("checkout", checkout)],
        recommendation: "Open the checkout page in the WordPress editor to confirm whether it uses the Checkout block or the classic shortcode, then sync a fresh snapshot and re-run this check.",
        confidence: "LOW",
        requiredAdditionalEvidence: "The checkout page implementation from the WordPress editor.",
      }));
    }
  }
  if (skipped.length > 0) {
    findings.push(finding({
      ruleId: "K", category: "EVIDENCE", severity: "LOW", status: "INSUFFICIENT_EVIDENCE",
      title: "Some checks were skipped because version data was malformed",
      description: "One or more version comparisons were skipped because a declared or observed version string could not be parsed. Skipped checks are listed in the evidence; they were not approximated.",
      evidence: { declared: null, observed: { skipped } },
      referencedItems: [],
      recommendation: "Correct the malformed version, sync a fresh snapshot, then re-run this check.",
      confidence: "MEDIUM",
      requiredAdditionalEvidence: "Parseable version strings for the skipped items.",
    }));
  }

  return { findings, skipped };
}
