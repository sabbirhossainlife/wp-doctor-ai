// Milestone 7 unit tests: deterministic WooCommerce rule engine + snapshot
// validator (v1/v2/v3). Pure functions — no database required.
import test from "node:test";
import assert from "node:assert/strict";
import { runWooRules, normalizeWooSnapshot } from "../lib/woocommerce/engine.js";
import { validateSnapshot } from "../lib/connector/validate-snapshot.js";

function page(overrides = {}) {
  return { pageId: 10, exists: true, status: "publish", implementation: "block", ...overrides };
}
function gateway(overrides = {}) {
  return {
    id: "cod", title: "Cash on delivery", enabled: true, available: null,
    blockCompatibility: "UNKNOWN", blockCompatibilitySource: "not-determined", ...overrides,
  };
}
function woo(overrides = {}) {
  return {
    installed: true, active: true, version: "11.2.1", status: "AVAILABLE",
    pages: { cart: page({ pageId: 11 }), checkout: page({ pageId: 12 }), myAccount: page({ pageId: 13 }) },
    gateways: [gateway()],
    ...overrides,
  };
}
function snap(overrides = {}) {
  const base = {
    schemaVersion: 3, wordpressVersion: "7.1.3", phpVersion: "8.3.6",
    homeUrl: "https://example.com", siteUrl: "https://example.com", pluginVersion: "1.2.0",
    activePlugins: [{ name: "WooCommerce", version: "11.2.1" }],
    activeTheme: { name: "Theme", version: "1.0" }, multisite: false, locale: "en_US",
    plugins: [{ name: "WooCommerce", slug: "woocommerce", version: "11.2.1", active: true, networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: null, dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: 1700000000 }],
    theme: { name: "Theme", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null },
    woocommerce: woo(),
  };
  return { ...base, ...overrides };
}
const byRule = (findings, rule) => findings.filter((f) => f.ruleId === rule);
const symptom = (category = "UNKNOWN", description = "") => ({ category, description });

// --- Validator: v3 + backward compat ---
test("validator: v3 snapshot with WooCommerce section validates", () => {
  const r = validateSnapshot(snap());
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.woocommerce.status, "AVAILABLE");
});
test("validator: v1 and v2 snapshots still validate (legacy, no WooCommerce data)", () => {
  const v2 = snap(); delete v2.woocommerce; v2.schemaVersion = 2;
  assert.equal(validateSnapshot(v2).ok, true);
  const v1 = { schemaVersion: 1, wordpressVersion: "7.1.3", phpVersion: "8.3.6", homeUrl: "https://example.com", siteUrl: "https://example.com", pluginVersion: "1.1.0", activePlugins: [], activeTheme: null, multisite: false, locale: "en_US" };
  assert.equal(validateSnapshot(v1).ok, true);
});
test("validator: v3 without woocommerce, unknown woo keys, and gateway settings are rejected", () => {
  const missing = snap(); delete missing.woocommerce;
  assert.equal(validateSnapshot(missing).ok, false);
  const extra = snap(); extra.woocommerce = { ...extra.woocommerce, apiKey: "sk-secret" };
  assert.equal(validateSnapshot(extra).ok, false);
  const gwSecret = snap();
  gwSecret.woocommerce = { ...gwSecret.woocommerce, gateways: [{ ...gateway(), settings: { key: "x" } }] };
  assert.equal(validateSnapshot(gwSecret).ok, false);
  const tooMany = snap();
  tooMany.woocommerce = { ...tooMany.woocommerce, gateways: Array.from({ length: 101 }, (_, i) => gateway({ id: `g${i}` })) };
  assert.equal(validateSnapshot(tooMany).ok, false);
});

// --- Rule A: presence ---
test("rule A: AVAILABLE WooCommerce produces no presence finding", () => {
  const { findings } = runWooRules(snap(), symptom());
  assert.equal(byRule(findings, "A").length, 0);
});
test("rule A: NOT_INSTALLED is a confirmed finding, not an invented cause", () => {
  const s = snap({ woocommerce: woo({ installed: false, active: false, version: null, status: "NOT_INSTALLED", gateways: [] }) });
  const a = byRule(runWooRules(s, symptom()).findings, "A");
  assert.equal(a.length, 1);
  assert.equal(a[0].status, "CONFIRMED_COMPATIBILITY");
  assert.match(a[0].title, /not installed/);
});
test("rule A: INACTIVE is a confirmed finding", () => {
  const s = snap({ woocommerce: woo({ active: false, status: "INACTIVE" }) });
  const a = byRule(runWooRules(s, symptom()).findings, "A");
  assert.equal(a.length, 1);
  assert.match(a[0].title, /inactive/);
});
test("rule K (legacy): v2 snapshot yields INSUFFICIENT_EVIDENCE, never 'WooCommerce disabled'", () => {
  const v2 = snap(); delete v2.woocommerce; v2.schemaVersion = 2;
  const { findings } = runWooRules(v2, symptom());
  assert.equal(byRule(findings, "A").length, 0);
  const k = byRule(findings, "K");
  assert.ok(k.length >= 1);
  assert.equal(k[0].status, "INSUFFICIENT_EVIDENCE");
  // The K description explicitly says the absence is NEVER such a claim.
  assert.match(k[0].description, /NEVER a claim that WooCommerce is disabled/);
});
test("rule K (legacy): v1 snapshot also yields insufficient evidence only", () => {
  const v1 = { schemaVersion: 1, wordpressVersion: "7.1.3", phpVersion: "8.3.6", activePlugins: [], activeTheme: null };
  const { findings } = runWooRules(v1, symptom());
  assert.ok(byRule(findings, "K").length >= 1);
  assert.equal(byRule(findings, "A").length, 0);
});
test("rule K: UNKNOWN WooCommerce status yields insufficient evidence, no presence claim", () => {
  const s = snap({ woocommerce: woo({ installed: false, active: false, version: null, status: "UNKNOWN", gateways: [] }) });
  const { findings } = runWooRules(s, symptom());
  assert.equal(byRule(findings, "A").length, 0);
  assert.ok(byRule(findings, "K").some((f) => /could not be determined/.test(f.title)));
});

// --- Rules B/C/D: pages ---
test("rule B: missing checkout assignment is HIGH and confirmed", () => {
  const w = woo(); w.pages.checkout = page({ pageId: null, exists: false, status: "unknown", implementation: "unknown" });
  const b = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "B");
  assert.equal(b.length, 1);
  assert.equal(b[0].severity, "HIGH");
  assert.equal(b[0].status, "CONFIRMED_COMPATIBILITY");
});
test("rule B: missing cart and myAccount assignments are separate MEDIUM findings", () => {
  const w = woo();
  w.pages.cart = page({ pageId: null, exists: false, status: "unknown", implementation: "unknown" });
  w.pages.myAccount = page({ pageId: null, exists: false, status: "unknown", implementation: "unknown" });
  assert.equal(byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "B").length, 2);
});
test("rule C: assigned checkout page not found is HIGH and confirmed", () => {
  const w = woo(); w.pages.checkout = page({ pageId: 99, exists: false, status: "unknown", implementation: "unknown" });
  const c = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "C");
  assert.equal(c.length, 1);
  assert.equal(c[0].severity, "HIGH");
  assert.match(c[0].title, /not found/);
});
test("rule C: unpublished pages (draft checkout, private myAccount) are confirmed", () => {
  const w = woo();
  w.pages.checkout = page({ status: "draft" });
  w.pages.myAccount = page({ pageId: 13, status: "private" });
  assert.equal(byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "C").length, 2);
});
test("rule C: trash page is confirmed unpublished, unknown status is insufficient evidence", () => {
  const w = woo(); w.pages.checkout = page({ status: "trash" });
  let c = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "C");
  assert.equal(c[0].status, "CONFIRMED_COMPATIBILITY");
  w.pages.checkout = page({ status: "unknown" });
  c = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "C");
  assert.equal(c[0].status, "INSUFFICIENT_EVIDENCE");
});
test("rule D: same page for cart and checkout is HIGH and confirmed (official docs)", () => {
  const w = woo(); w.pages.cart = page({ pageId: 12 });
  const d = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "D");
  assert.equal(d.length, 1);
  assert.equal(d[0].severity, "HIGH");
  assert.match(d[0].description, /incorrect redirects/);
});
test("rule D: same page for all three roles is a single finding listing all roles", () => {
  const w = woo();
  w.pages.cart = page({ pageId: 12 }); w.pages.myAccount = page({ pageId: 12 });
  const d = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "D");
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].evidence.observed.roles, ["cart", "checkout", "myAccount"]);
});
test("rule D: distinct page ids produce no finding", () => {
  assert.equal(byRule(runWooRules(snap(), symptom()).findings, "D").length, 0);
});

// --- Rule E: block vs classic ---
test("rule E: classic shortcode checkout produces no block findings for an unknown gateway", () => {
  const w = woo(); w.pages.checkout = page({ implementation: "classic-shortcode" });
  const { findings } = runWooRules(snap({ woocommerce: w }), symptom());
  assert.equal(byRule(findings, "E").length, 0);
  assert.equal(byRule(findings, "G").length, 0);
});
test("rule E: block checkout + explicitly SUPPORTED gateway produces no finding", () => {
  const w = woo({ gateways: [gateway({ blockCompatibility: "SUPPORTED", blockCompatibilitySource: "declared" })] });
  const { findings } = runWooRules(snap({ woocommerce: w }), symptom());
  assert.equal(byRule(findings, "E").length, 0);
  assert.equal(byRule(findings, "G").length, 0);
});
test("rule E: block checkout + explicitly declared UNSUPPORTED gateway is confirmed incompatibility, never a classic-switch recommendation", () => {
  const w = woo({ gateways: [gateway({ blockCompatibility: "UNSUPPORTED", blockCompatibilitySource: "declared" })] });
  const e = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "E");
  assert.equal(e.length, 1);
  assert.equal(e[0].status, "CONFIRMED_COMPATIBILITY");
  assert.doesNotMatch(e[0].recommendation, /switch.*classic/i);
  assert.match(e[0].description, /not a proven payment failure/);
});
test("rule E: classic checkout + declared UNSUPPORTED gateway produces no finding (irrelevant)", () => {
  const w = woo({ gateways: [gateway({ blockCompatibility: "UNSUPPORTED", blockCompatibilitySource: "declared" })] });
  w.pages.checkout = page({ implementation: "classic-shortcode" });
  assert.equal(byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "E").length, 0);
});
test("rule E: unknown checkout implementation + declared UNSUPPORTED is POTENTIAL, not confirmed", () => {
  const w = woo({ gateways: [gateway({ blockCompatibility: "UNSUPPORTED", blockCompatibilitySource: "declared" })] });
  w.pages.checkout = page({ implementation: "unknown" });
  const e = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "E");
  assert.equal(e.length, 1);
  assert.equal(e[0].status, "POTENTIAL");
});
test("rule E: UNSUPPORTED without a trustworthy source is only POTENTIAL, never confirmed", () => {
  const w = woo({ gateways: [gateway({ blockCompatibility: "UNSUPPORTED", blockCompatibilitySource: "not-determined" })] });
  const e = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "E");
  assert.equal(e.length, 1);
  assert.equal(e[0].status, "POTENTIAL");
});

// --- Rules F/G: gateways ---
test("rule F: no gateways enabled is POTENTIAL with a manual-workflow caveat, not a payment-system failure claim", () => {
  const w = woo({ gateways: [gateway({ enabled: false }), gateway({ id: "bacs", title: "Bank transfer", enabled: false })] });
  const f = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "F");
  assert.equal(f.length, 1);
  assert.equal(f[0].status, "POTENTIAL");
  assert.match(f[0].description, /manual/);
});
test("rule F: empty registered gateway list also yields the no-enabled finding", () => {
  const w = woo({ gateways: [] });
  assert.equal(byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "F").length, 1);
});
test("rule G: enabled gateway with unknown compatibility on block checkout is a warning, not a failure", () => {
  const g = byRule(runWooRules(snap(), symptom()).findings, "G");
  assert.equal(g.length, 1);
  assert.equal(g[0].status, "POTENTIAL");
  assert.match(g[0].description, /not a failure/);
});
test("rule G: multiple enabled gateways yield one warning each; disabled unknown gateways are skipped", () => {
  const w = woo({ gateways: [gateway(), gateway({ id: "bacs", title: "Bank transfer" }), gateway({ id: "cheque", title: "Cheque", enabled: false })] });
  assert.equal(byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "G").length, 2);
});

// --- Rule H: version requirements ---
test("rule H: WooCommerce PHP requirement above site PHP is a confirmed compatibility finding", () => {
  const s = snap();
  s.plugins = [{ ...s.plugins[0], requiresPHP: "8.4" }];
  const h = byRule(runWooRules(s, symptom()).findings, "H");
  assert.equal(h.length, 1);
  assert.equal(h[0].status, "CONFIRMED_COMPATIBILITY");
  assert.match(h[0].title, /requires PHP 8\.4/);
});
test("rule H: WooCommerce WP requirement above site WP is confirmed; met requirements produce none", () => {
  const s = snap();
  s.plugins = [{ ...s.plugins[0], requiresWP: "7.2", requiresPHP: "8.1" }];
  assert.equal(byRule(runWooRules(s, symptom()).findings, "H").length, 1);
  s.plugins = [{ ...s.plugins[0], requiresWP: "7.0", requiresPHP: "8.0" }];
  assert.equal(byRule(runWooRules(s, symptom()).findings, "H").length, 0);
});
test("rule H: malformed requirement versions are skipped with a K finding, never approximated", () => {
  const s = snap();
  s.plugins = [{ ...s.plugins[0], requiresPHP: "x.y" }];
  const { findings, skipped } = runWooRules(s, symptom());
  assert.equal(byRule(findings, "H").length, 0);
  assert.ok(skipped.some((x) => x.ruleId === "H"));
  assert.ok(byRule(findings, "K").some((f) => /malformed/.test(f.title)));
});
test("rule K: missing WooCommerce version yields insufficient evidence, no invented version", () => {
  const w = woo({ version: null });
  const k = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "K");
  assert.ok(k.some((f) => /version is unknown/.test(f.title)));
});
test("rule K: unknown checkout implementation yields insufficient evidence", () => {
  const w = woo(); w.pages.checkout = page({ implementation: "unknown" });
  // Unknown impl also makes G insufficient-evidence; K must still appear.
  const k = byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "K");
  assert.ok(k.some((f) => /could not be classified/.test(f.title)));
});

// --- Rules I/J: symptom handling ---
test("rule I: symptom is context only, never a cause", () => {
  const { findings } = runWooRules(snap(), symptom("AFTER_UPDATE", "Checkout broke after the update."));
  const i = byRule(findings, "I");
  assert.equal(i.length, 1);
  assert.equal(i[0].status, "INSUFFICIENT_EVIDENCE");
  assert.match(i[0].description, /not treated as a verified fact/);
});
test("rule J: reported payment failure without evidence yields no success/failure claim", () => {
  const { findings } = runWooRules(snap(), symptom("PAYMENT_DECLINED_OR_FAILED", "My payment failed."));
  const j = byRule(findings, "J");
  assert.equal(j.length, 1);
  assert.equal(j[0].status, "INSUFFICIENT_EVIDENCE");
  assert.match(j[0].title, /cannot be verified/);
  assert.doesNotMatch(JSON.stringify(j), /payment (succeeded|failed) on/i);
});
test("rule J: reported pending order without transaction status yields the manual-investigation pathway", () => {
  const { findings } = runWooRules(snap(), symptom("ORDER_PENDING", "Order stuck pending."));
  const j = byRule(findings, "J");
  assert.equal(j.length, 1);
  assert.match(j[0].recommendation, /payment provider's dashboard/);
  assert.match(j[0].evidence.observed.ordersInspected.toString(), /false/);
});
test("rule J: non-payment symptoms produce no J finding", () => {
  const { findings } = runWooRules(snap(), symptom("SHIPPING_OR_TAX", "Tax looks wrong."));
  assert.equal(byRule(findings, "J").length, 0);
});

// --- Invariants + malformed data ---
test("invariants: a clean configuration claims neither payment success nor checkout success", () => {
  const w = woo({ gateways: [gateway({ blockCompatibility: "SUPPORTED", blockCompatibilitySource: "declared" })] });
  const { findings } = runWooRules(snap({ woocommerce: w }), symptom());
  assert.equal(findings.length, 0);
  assert.doesNotMatch(JSON.stringify(findings), /payment will succeed|checkout works/i);
});
test("malformed snapshot fields do not crash the engine and degrade to insufficient evidence", () => {
  const s = snap({ woocommerce: { installed: "yes", active: 1, version: 123, status: "BOGUS", pages: { checkout: { pageId: -5, exists: "maybe", status: 9, implementation: [] } }, gateways: [null, { title: "No id" }, gateway()] } });
  const { findings } = runWooRules(s, symptom());
  // Status normalizes to UNKNOWN -> K finding; the valid gateway still runs G.
  assert.ok(byRule(findings, "K").length >= 1);
  assert.equal(byRule(findings, "A").length, 0);
  const n = normalizeWooSnapshot(s);
  assert.equal(n.woo.status, "UNKNOWN");
  assert.equal(n.woo.gateways.length, 1);
});
test("normalize: v3 pages with a null role entry are treated as missing assignment, not as published", () => {
  const w = woo(); w.pages.checkout = null;
  const n = normalizeWooSnapshot(snap({ woocommerce: w }));
  assert.equal(n.woo.pages.checkout, null);
  assert.equal(byRule(runWooRules(snap({ woocommerce: w }), symptom()).findings, "B").length, 1);
});
