// Milestone 8 false-positive prevention: the 11 hard invariants, each asserted.
import test from "node:test";
import assert from "node:assert/strict";
import { runElementorRules } from "../lib/elementor/engine.js";

function elPlugin(overrides = {}) {
  return {
    name: "Elementor", slug: "elementor", version: "4.3.5", active: true, networkActive: false, muPlugin: false,
    requiresWP: "6.5", requiresPHP: "7.4", dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: 1700000000,
    ...overrides,
  };
}
function snap(overrides = {}) {
  return {
    schemaVersion: 4, wordpressVersion: "7.1.3", phpVersion: "8.3.6",
    homeUrl: "https://example.com", siteUrl: "https://example.com", pluginVersion: "1.3.0",
    activePlugins: [{ name: "Elementor", version: "4.3.5" }],
    activeTheme: { name: "Theme", version: "1.0" }, multisite: false, locale: "en_US",
    plugins: [elPlugin()],
    theme: { name: "Theme", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null },
    woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: true, active: true, version: "4.3.5", pro: { installed: false, active: false, version: null }, status: "AVAILABLE" },
    environment: { phpMemoryLimit: "512M", wpMemoryLimit: "512M", maxExecutionTime: "300" },
    ...overrides,
  };
}
const byRule = (findings, rule) => findings.filter((f) => f.ruleId === rule);
const json = (findings) => JSON.stringify(findings);

test("invariant 1: installed does not mean working (healthy snapshot claims nothing)", () => {
  const { findings } = runElementorRules(snap(), { category: "OTHER_OR_UNKNOWN", description: "" });
  assert.equal(findings.length, 0);
  assert.doesNotMatch(json(findings), /works correctly|verified working/);
});
test("invariant 2: Pro installed does not mean version conflict", () => {
  const s = snap({
    elementor: { installed: true, active: true, version: "4.3.5", pro: { installed: true, active: true, version: "4.3.0" }, status: "AVAILABLE" },
    plugins: [elPlugin(), { ...elPlugin(), name: "Elementor Pro", slug: "elementor-pro", version: "4.3.0" }],
  });
  assert.equal(byRule(runElementorRules(s, { category: "OTHER_OR_UNKNOWN", description: "" }).findings, "B").length, 0);
});
test("invariant 3: post-update does not mean caused-by-update", () => {
  const { findings } = runElementorRules(snap(), { category: "ELEMENTOR_EDITOR_NOT_LOADING", description: "Broke.", updatePreceded: true });
  const e = byRule(findings, "E");
  assert.equal(e.length, 1);
  assert.match(e[0].description, /does NOT prove the update caused it/);
});
test("invariant 4: memory warning does not mean exhaustion proven", () => {
  const s = snap({ environment: { phpMemoryLimit: "128M", wpMemoryLimit: "128M", maxExecutionTime: "300" } });
  const d = byRule(runElementorRules(s, { category: "OTHER_OR_UNKNOWN", description: "" }).findings, "D");
  assert.equal(d.length, 1);
  assert.match(d[0].description, /does NOT prove memory exhaustion/);
});
test("invariant 5: HTTP 200 does not mean layout correct (no HTTP pass exists)", () => {
  const { findings } = runElementorRules(snap(), { category: "FRONTEND_LAYOUT_BROKEN", description: "Broken.", affectedScope: "frontend" });
  assert.doesNotMatch(json(findings), /HTTP 200.*correct|layout is correct/);
  assert.ok(byRule(findings, "I").some((f) => /UNVERIFIED/.test(f.description)));
});
test("invariant 6: user-reported JS error is not an independently verified browser error", () => {
  const { findings } = runElementorRules(snap(), { category: "ELEMENTOR_JAVASCRIPT_ERROR", description: "JS broke.", errorExcerpt: "Uncaught TypeError" });
  const h = byRule(findings, "H");
  assert.equal(h.length, 1);
  assert.match(h[0].title, /No independently verified/);
  assert.doesNotMatch(json(findings), /Uncaught TypeError/);
});
test("invariant 7: missing field is not a negative finding", () => {
  const v3 = snap(); delete v3.elementor; delete v3.environment; v3.schemaVersion = 3;
  const { findings } = runElementorRules(v3, { category: "OTHER_OR_UNKNOWN", description: "" });
  assert.equal(byRule(findings, "A").length, 0);
  assert.ok(byRule(findings, "J").some((f) => f.status === "INSUFFICIENT_EVIDENCE"));
});
test("invariant 8: subdirectory is not a URL mismatch", () => {
  const s = snap({ homeUrl: "https://example.com/shop", siteUrl: "https://example.com" });
  assert.equal(byRule(runElementorRules(s, { category: "OTHER_OR_UNKNOWN", description: "" }).findings, "F").length, 0);
});
test("invariant 9: Safe Mode is not a universal fix", () => {
  const { findings } = runElementorRules(snap(), { category: "ELEMENTOR_EDITOR_NOT_LOADING", description: "Stuck." });
  const e = byRule(findings, "E")[0];
  assert.match(e.description, /not a guaranteed fix/);
  assert.match(e.description, /does not fix live-page layout/);
});
test("invariant 10: no visual test means visual unverified", () => {
  const { findings } = runElementorRules(snap(), { category: "FRONTEND_LAYOUT_BROKEN", description: "Looks wrong.", affectedScope: "frontend" });
  const i = byRule(findings, "I")[0];
  assert.match(i.description, /No rendering or visual test was performed/);
  assert.match(i.description, /UNVERIFIED/);
});
test("invariant 11: conflict candidate is not a confirmed conflict", () => {
  const s = snap({ plugins: [elPlugin(), { ...elPlugin(), name: "Other", slug: "other" }] });
  const g = byRule(runElementorRules(s, { category: "OTHER_OR_UNKNOWN", description: "" }).findings, "G");
  assert.equal(g.length, 1);
  assert.match(g[0].description, /no conflict has been established/);
  assert.match(g[0].description, /CANDIDATES/);
});
