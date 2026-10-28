// Tool 08 connector schema v6 tests + v1-v5 regression (Milestone 12).
import test from "node:test";
import assert from "node:assert/strict";
import { validateSnapshot } from "../lib/connector/validate-snapshot.js";

function v5Payload() {
  return {
    schemaVersion: 5,
    wordpressVersion: "7.1.3", phpVersion: "8.3.6",
    homeUrl: "https://example.com", siteUrl: "https://example.com",
    pluginVersion: "1.4.0", activePlugins: [], activeTheme: { name: "T", version: "1" },
    multisite: false, locale: "en_US", plugins: [], theme: null,
    woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: false, active: false, version: null, pro: { installed: false, active: false, version: null }, status: "NOT_INSTALLED" },
    environment: { phpMemoryLimit: null, wpMemoryLimit: null, maxExecutionTime: null },
    contactForms: [], mailTransport: [],
    senderDomain: { senderConfigured: "unknown", senderDomain: null, domainMatches: null, comparisonEstablished: false },
  };
}

test("v5 still validates exactly as before", () => {
  const r = validateSnapshot(v5Payload());
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.schemaVersion, 5);
  assert.equal("securityIndicators" in r.snapshot, false);
});

test("v1 still validates", () => {
  const r = validateSnapshot({
    schemaVersion: 1, wordpressVersion: "7.1.3", phpVersion: "8.3.6",
    homeUrl: "https://example.com", siteUrl: "https://example.com",
    pluginVersion: "1.0.0", activePlugins: [{ name: "A", version: "1.0" }],
    activeTheme: { name: "T", version: "1" }, multisite: false, locale: "en_US",
  });
  assert.equal(r.ok, true);
});

test("v6 validates with securityIndicators; values are minimized to yes/no/unknown", () => {
  const payload = { ...v5Payload(), schemaVersion: 6, securityIndicators: { wpDebug: "no", wpDebugDisplay: "yes", wpDebugLog: "unknown", disallowFileEdit: "no" } };
  const r = validateSnapshot(payload);
  assert.equal(r.ok, true);
  assert.deepEqual(r.snapshot.securityIndicators, { wpDebug: "no", wpDebugDisplay: "yes", wpDebugLog: "unknown", disallowFileEdit: "no" });
});

test("v6 rejects bad indicator values, unknown keys, and secret-bearing keys", () => {
  const base = { ...v5Payload(), schemaVersion: 6 };
  assert.equal(validateSnapshot({ ...base, securityIndicators: { wpDebug: "maybe", wpDebugDisplay: "no", wpDebugLog: "no", disallowFileEdit: "no" } }).ok, false);
  assert.equal(validateSnapshot({ ...base, securityIndicators: { wpDebug: "no" } }).ok, false);
  assert.equal(validateSnapshot({ ...base, securityIndicators: { wpDebug: "no", wpDebugDisplay: "no", wpDebugLog: "no", disallowFileEdit: "no", wpConfigContents: "secret" } }).ok, false);
  assert.equal(validateSnapshot({ ...base, securityIndicators: { wpDebug: "no", wpDebugDisplay: "no", wpDebugLog: "no", disallowFileEdit: "no", users: [] } }).ok, false);
  assert.equal(validateSnapshot({ ...base }).ok, false, "v6 without securityIndicators is invalid");
  assert.equal(validateSnapshot({ ...base, securityIndicators: "no" }).ok, false);
});

test("unknown schema versions still rejected", () => {
  assert.equal(validateSnapshot({ ...v5Payload(), schemaVersion: 7 }).ok, false);
  assert.equal(validateSnapshot({ ...v5Payload(), schemaVersion: 0 }).ok, false);
});
