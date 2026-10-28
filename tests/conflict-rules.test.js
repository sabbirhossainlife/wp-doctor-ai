// Milestone 6 unit tests: version comparator, deterministic rule engine,
// snapshot validator (v1 + v2). Pure functions — no database required.
import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, parseVersion, isBelowMinimum } from "../lib/conflict/versions.js";
import { runConflictRules, normalizeSnapshot } from "../lib/conflict/engine.js";
import { validateSnapshot } from "../lib/connector/validate-snapshot.js";

function plugin(overrides = {}) {
  return {
    name: "Sample",
    slug: "sample",
    version: "1.0.0",
    active: true,
    networkActive: false,
    muPlugin: false,
    requiresWP: null,
    requiresPHP: null,
    dependencies: [],
    updateAvailable: false,
    newVersion: null,
    updateCheckedAt: 1700000000,
    ...overrides,
  };
}

function snap(overrides = {}) {
  const base = {
    schemaVersion: 2,
    wordpressVersion: "6.8",
    phpVersion: "8.3",
    homeUrl: "https://example.com",
    siteUrl: "https://example.com",
    pluginVersion: "1.1.0",
    activePlugins: [],
    activeTheme: { name: "Theme", version: "1.0" },
    multisite: false,
    locale: "en_US",
    plugins: [],
    theme: { name: "Theme", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null },
  };
  const s = { ...base, ...overrides };
  if (!overrides.activePlugins) {
    s.activePlugins = s.plugins.filter((p) => p.active).map((p) => ({ name: p.name, version: p.version }));
  }
  return s;
}

const byRule = (findings, rule) => findings.filter((f) => f.ruleId === rule);

// --- Version comparator ---
test("versions: numeric segments compare numerically, not alphabetically", () => {
  assert.equal(compareVersions("10.0", "9.0"), 1);
  assert.equal(compareVersions("9.0", "10.0"), -1);
  assert.equal(compareVersions("6.8", "6.8.0"), 0);
  assert.equal(compareVersions("1.0-beta1", "1.0"), -1);
  assert.equal(compareVersions("1.0-alpha", "1.0-beta"), -1);
  assert.equal(compareVersions("1.0-rc1", "1.0-beta9"), 1);
  assert.equal(compareVersions("8.3.6", "8.3"), 1);
});

test("versions: malformed versions return null and skip rules", () => {
  assert.equal(parseVersion("x.y"), null);
  assert.equal(parseVersion(""), null);
  assert.equal(parseVersion("1.0.x"), null);
  assert.equal(parseVersion("1..2"), null);
  assert.equal(compareVersions("x.y", "1.0"), null);
  assert.equal(isBelowMinimum("8.3", "x.y"), null);
});

// --- Rule A/B ---
test("rule A: PHP match produces no finding; mismatch is confirmed compatibility, not a crash", () => {
  const ok = runConflictRules(snap({ plugins: [plugin({ requiresPHP: "8.1" })] }));
  assert.equal(byRule(ok.findings, "A").length, 0);
  const bad = runConflictRules(snap({ plugins: [plugin({ requiresPHP: "8.4" })] }));
  const a = byRule(bad.findings, "A");
  assert.equal(a.length, 1);
  assert.equal(a[0].status, "CONFIRMED_COMPATIBILITY");
  assert.equal(a[0].evidence.declared.requiresPHP, "8.4");
  assert.equal(a[0].evidence.observed.phpVersion, "8.3");
  assert.match(a[0].description, /does not by itself prove any specific error or crash/);
  assert.doesNotMatch(a[0].title, /crash/i);
});

test("rule B: WP mismatch for plugin; inactive plugin mismatch is ignored", () => {
  const bad = runConflictRules(snap({ plugins: [plugin({ requiresWP: "6.9" })] }));
  assert.equal(byRule(bad.findings, "B").length, 1);
  const inactive = runConflictRules(snap({ plugins: [plugin({ requiresWP: "6.9", active: false })] }));
  assert.equal(byRule(inactive.findings, "B").length, 0);
  assert.equal(byRule(inactive.findings, "A").length, 0);
});

// --- Missing / malformed metadata ---
test("rules: missing requirement metadata yields no invented mismatch, only insufficient-evidence context", () => {
  const r = runConflictRules(snap({ plugins: [plugin()] }));
  assert.equal(byRule(r.findings, "A").length, 0);
  assert.equal(byRule(r.findings, "B").length, 0);
  assert.ok(byRule(r.findings, "H").some((f) => /requirement metadata/.test(f.title)));
});

test("rules: malformed requirement version skips the rule with a recorded reason", () => {
  const r = runConflictRules(snap({ plugins: [plugin({ requiresPHP: "banana" })] }));
  assert.equal(byRule(r.findings, "A").length, 0);
  assert.ok(r.skipped.some((s) => s.ruleId === "A"));
  assert.ok(byRule(r.findings, "H").some((f) => /skipped/.test(f.title)));
});

// --- Rule C ---
test("rule C: dependency present+active is fine; missing is confirmed; inactive is potential", () => {
  const present = runConflictRules(snap({
    plugins: [
      plugin({ name: "Main", slug: "main", dependencies: ["helper"] }),
      plugin({ name: "Helper", slug: "helper" }),
    ],
  }));
  assert.equal(byRule(present.findings, "C").length, 0);

  const missing = runConflictRules(snap({
    plugins: [plugin({ name: "Main", slug: "main", dependencies: ["helper"] })],
  }));
  const cm = byRule(missing.findings, "C");
  assert.equal(cm.length, 1);
  assert.equal(cm[0].status, "CONFIRMED_COMPATIBILITY");
  assert.equal(cm[0].referencedItems[1].slug, "helper");

  const inactive = runConflictRules(snap({
    plugins: [
      plugin({ name: "Main", slug: "main", dependencies: ["helper"] }),
      plugin({ name: "Helper", slug: "helper", active: false }),
    ],
  }));
  const ci = byRule(inactive.findings, "C");
  assert.equal(ci.length, 1);
  assert.equal(ci[0].status, "POTENTIAL");
});

test("rule C: absent dependency header means no dependency finding is invented", () => {
  const r = runConflictRules(snap({ plugins: [plugin()] }));
  assert.equal(byRule(r.findings, "C").length, 0);
});

// --- Rule D ---
test("rule D: active entry without inventory metadata; duplicate inventory entries", () => {
  const s = snap({ plugins: [plugin({ name: "Known", slug: "known" })] });
  s.activePlugins = [{ name: "Ghost", version: "1.0" }, { name: "Known", version: "1.0.0" }];
  const r = runConflictRules(s);
  assert.ok(byRule(r.findings, "D").some((f) => /Ghost/.test(f.title)));
  assert.equal(byRule(r.findings, "D").filter((f) => /Ghost/.test(f.title))[0].status, "INSUFFICIENT_EVIDENCE");

  const dup = runConflictRules(snap({
    plugins: [plugin({ name: "A", slug: "dup" }), plugin({ name: "B", slug: "dup" })],
  }));
  assert.ok(byRule(dup.findings, "D").some((f) => /Duplicate/.test(f.title)));
});

// --- Multisite + mu-plugin ---
test("rules: network-active and mu-plugins are treated as active for checks", () => {
  const r = runConflictRules(snap({
    multisite: true,
    plugins: [
      plugin({ name: "Net", slug: "net", networkActive: true, requiresPHP: "8.4" }),
      plugin({ name: "MU", slug: "mu", muPlugin: true, requiresWP: "6.9" }),
    ],
  }));
  assert.equal(byRule(r.findings, "A").length, 1);
  assert.equal(byRule(r.findings, "B").length, 1);
});

// --- Rule E ---
test("rule E: update available is a potential notice, never a vulnerability claim; missing update data invents nothing", () => {
  const r = runConflictRules(snap({ plugins: [plugin({ updateAvailable: true, newVersion: "1.1.0" })] }));
  const e = byRule(r.findings, "E");
  assert.equal(e.length, 1);
  assert.equal(e[0].status, "POTENTIAL");
  assert.match(e[0].description, /NOT a claim that .* is vulnerable/);
  assert.doesNotMatch(e[0].title, /vulnerab/i);

  const noInfo = runConflictRules(snap({ plugins: [plugin({ updateCheckedAt: null })] }));
  assert.equal(byRule(noInfo.findings, "E").length, 0);
  assert.ok(byRule(noInfo.findings, "H").some((f) => /update information/.test(f.title)));
});

// --- Rule F ---
test("rule F: theme requirement mismatch + parent-theme distinction", () => {
  const mismatch = runConflictRules(snap({
    theme: { name: "Theme", version: "1.0", parentName: null, parentVersion: null, requiresWP: "6.9", requiresPHP: "8.4" },
  }));
  assert.equal(byRule(mismatch.findings, "F").length, 2);
  // Theme mismatch must not also appear under plugin rules A/B.
  assert.equal(byRule(mismatch.findings, "A").length, 0);
  assert.equal(byRule(mismatch.findings, "B").length, 0);

  const child = runConflictRules(snap({
    theme: { name: "Child", version: "1.0", parentName: "Parent", parentVersion: null, requiresWP: null, requiresPHP: null },
  }));
  const f = byRule(child.findings, "F");
  assert.equal(f.length, 1);
  assert.equal(f[0].status, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(f[0].referencedItems.map((it) => it.name), ["Child", "Parent"]);
});

// --- Rule G/H + invariants ---
test("rule G: symptom is context only, never a cause; post-update symptom never proves causation", () => {
  const r = runConflictRules(
    snap({ plugins: [plugin({ updateAvailable: true, newVersion: "2.0" })] }),
    { category: "UPDATE_ERROR", description: "Broke right after updating Sample." },
  );
  const g = byRule(r.findings, "G");
  assert.equal(g.length, 1);
  assert.equal(g[0].status, "INSUFFICIENT_EVIDENCE");
  assert.match(g[0].description, /does not prove/);
  for (const f of r.findings) {
    assert.doesNotMatch(`${f.title} ${f.description}`, /is the cause/i);
  }
});

test("invariants: two active plugins alone never yield a confirmed conflict; no TLS/log claims; missing data stays missing", () => {
  const r = runConflictRules(
    snap({ plugins: [plugin({ name: "One", slug: "one" }), plugin({ name: "Two", slug: "two" })] }),
    { category: "FRONTEND_BROKEN", description: "Page is blank." },
  );
  assert.equal(r.findings.filter((f) => f.category === "PLUGIN_CONFLICT").length, 0);
  assert.equal(r.findings.filter((f) => /conflict between/i.test(f.title)).length, 0);
  for (const f of r.findings) {
    assert.doesNotMatch(`${f.title} ${f.description}`, /TLS|server log|log file/i);
    assert.equal(f.status === "CONFIRMED_COMPATIBILITY" && f.category === "PLUGIN_CONFLICT", false);
  }
  // No finding claims a value that was null in the snapshot.
  assert.ok(!JSON.stringify(r.findings).includes("undefined"));
});

test("v1 snapshots: A/B/C/E cannot run; single extended-snapshot H finding; D/H still apply", () => {
  const v1 = {
    schemaVersion: 1,
    wordpressVersion: "6.8",
    phpVersion: "8.3",
    homeUrl: "https://example.com",
    siteUrl: "https://example.com",
    pluginVersion: "1.0.0",
    activePlugins: [{ name: "Old", version: "1.0" }, { name: "NoVer", version: null }],
    activeTheme: { name: "Theme", version: "1.0" },
    multisite: false,
    locale: "en_US",
  };
  const r = runConflictRules(v1, { category: "OTHER", description: "Something broke." });
  assert.equal(byRule(r.findings, "A").length, 0);
  assert.equal(byRule(r.findings, "B").length, 0);
  assert.equal(byRule(r.findings, "C").length, 0);
  assert.equal(byRule(r.findings, "E").length, 0);
  assert.equal(byRule(r.findings, "H").filter((f) => /Extended snapshot/.test(f.title)).length, 1);
  assert.ok(byRule(r.findings, "D").some((f) => /NoVer/.test(f.title)));
  const n = normalizeSnapshot(v1);
  assert.equal(n.schemaVersion, 1);
  assert.equal(n.plugins[0].requiresPHP, null);
  assert.equal(n.plugins[0].active, true);
});

// --- Validator ---
test("validator: v1 accepted, v2 accepted, strict allowlists enforced", () => {
  const v1 = {
    schemaVersion: 1, wordpressVersion: "6.8", phpVersion: "8.3",
    homeUrl: "https://example.com", siteUrl: "https://example.com", pluginVersion: "1.0.0",
    activePlugins: [{ name: "A", version: "1.0" }], activeTheme: { name: "T", version: "1.0" },
    multisite: false, locale: "en_US",
  };
  assert.equal(validateSnapshot(v1).ok, true);
  assert.equal(validateSnapshot({ ...v1, plugins: [] }).ok, false, "v1 must reject v2-only keys");

  const v2 = { ...v1, schemaVersion: 2, plugins: [plugin()], theme: { name: "T", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null } };
  const ok = validateSnapshot(v2);
  assert.equal(ok.ok, true);
  assert.equal(ok.snapshot.schemaVersion, 2);
  assert.equal(ok.snapshot.plugins[0].slug, "sample");

  assert.equal(validateSnapshot({ ...v2, plugins: [{ ...plugin(), secret: "x" }] }).ok, false);
  assert.equal(validateSnapshot({ ...v2, plugins: [{ ...plugin(), dependencies: ["BAD SLUG!"] }] }).ok, false);
  assert.equal(validateSnapshot({ ...v2, schemaVersion: 3 }).ok, false);
  assert.equal(validateSnapshot({ ...v2, plugins: [{ ...plugin(), updateCheckedAt: -1 }] }).ok, false);
});
