// Tool 07 validator tests: v5 acceptance, v1–v4 backward compatibility,
// and rejection of secret-bearing / out-of-allowlist fields.
import test from "node:test";
import assert from "node:assert/strict";
import { validateSnapshot } from "../lib/connector/validate-snapshot.js";

function base(version) {
  return {
    schemaVersion: version,
    wordpressVersion: "7.1.3",
    phpVersion: "8.3.6",
    homeUrl: "https://example.com",
    siteUrl: "https://example.com",
    pluginVersion: "1.4.0",
    activePlugins: [{ name: "Contact Form 7", version: "6.2.3" }],
    activeTheme: { name: "Oishi", version: "1.0" },
    multisite: false,
    locale: "en_US",
  };
}
function fullInventory() {
  return [
    { name: "Contact Form 7", slug: "contact-form-7", version: "6.2.3", active: true, networkActive: false, muPlugin: false, requiresWP: "7.1", requiresPHP: "8.3", dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: null },
  ];
}
function v5Extras() {
  return {
    contactForms: [
      { pluginId: "contact-form-7", name: "Contact Form 7", installed: true, active: true, version: "6.2.3", adapterName: "contact-form-7", adapterVersion: "1", coverage: "COMPLETE", formsCount: 2, notificationConfigured: "yes", mailConfigStatus: "CONFIGURED" },
      { pluginId: "unknown", name: "Unknown or custom form integration", installed: false, active: false, version: null, adapterName: null, adapterVersion: null, coverage: "UNSUPPORTED", formsCount: null, notificationConfigured: null, mailConfigStatus: null },
    ],
    mailTransport: [
      { pluginId: "wp-mail-smtp", name: "WP Mail SMTP", installed: true, active: true, version: "4.0.0", configPresent: "yes", requiredFieldsComplete: "yes", mailer: "smtp", senderConfigured: "yes", senderDomain: "example.com", coverage: "PARTIAL" },
    ],
    senderDomain: { senderConfigured: "yes", senderDomain: "example.com", domainMatches: null, comparisonEstablished: false },
  };
}

test("validator: v5 snapshot validates and is minimized to allowlisted fields", () => {
  const payload = {
    ...base(5),
    plugins: fullInventory(),
    theme: null,
    woocommerce: { installed: true, active: true, version: "11.2.1", status: "AVAILABLE", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: true, active: true, version: "4.3.5", pro: { installed: false, active: false, version: null }, status: "AVAILABLE" },
    environment: { phpMemoryLimit: "256M", wpMemoryLimit: "256M", maxExecutionTime: "30" },
    ...v5Extras(),
  };
  const result = validateSnapshot(payload);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.schemaVersion, 5);
  assert.equal(result.snapshot.contactForms.length, 2);
  assert.equal(result.snapshot.mailTransport[0].senderDomain, "example.com");
  assert.equal(result.snapshot.senderDomain.comparisonEstablished, false);
});

test("validator: v1–v4 snapshots still validate exactly as before", () => {
  assert.equal(validateSnapshot(base(1)).ok, true);
  const v2 = { ...base(2), plugins: fullInventory(), theme: null };
  assert.equal(validateSnapshot(v2).ok, true);
  const v3 = { ...v2, schemaVersion: 3, woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] } };
  assert.equal(validateSnapshot(v3).ok, true);
  const v4 = { ...v3, schemaVersion: 4, elementor: { installed: false, active: false, version: null, pro: { installed: false, active: false, version: null }, status: "NOT_INSTALLED" }, environment: { phpMemoryLimit: null, wpMemoryLimit: null, maxExecutionTime: null } };
  assert.equal(validateSnapshot(v4).ok, true);
  // v4 payload must NOT gain v5 fields through validation.
  assert.equal(validateSnapshot(v4).snapshot.contactForms, undefined);
});

test("validator: secret-bearing and out-of-allowlist fields reject the payload", () => {
  const payload = {
    ...base(5),
    plugins: fullInventory(),
    theme: null,
    woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: false, active: false, version: null, pro: { installed: false, active: false, version: null }, status: "NOT_INSTALLED" },
    environment: { phpMemoryLimit: null, wpMemoryLimit: null, maxExecutionTime: null },
    contactForms: [{ pluginId: "contact-form-7", name: "Contact Form 7", installed: true, active: true, version: "6.2.3", coverage: "COMPLETE", recipient: "admin@example.com", smtpPassword: "SENTINEL_SECRET_XYZ" }],
    mailTransport: [],
    senderDomain: { senderConfigured: "yes", senderDomain: "example.com", domainMatches: null, comparisonEstablished: false },
  };
  assert.equal(validateSnapshot(payload).ok, false);

  const fullAddress = {
    ...base(5),
    plugins: fullInventory(),
    theme: null,
    woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: false, active: false, version: null, pro: { installed: false, active: false, version: null }, status: "NOT_INSTALLED" },
    environment: { phpMemoryLimit: null, wpMemoryLimit: null, maxExecutionTime: null },
    contactForms: [],
    mailTransport: [{ pluginId: "wp-mail-smtp", name: "WP Mail SMTP", installed: true, active: true, version: "4.0.0", configPresent: "yes", requiredFieldsComplete: "yes", mailer: "smtp", senderConfigured: "yes", senderDomain: "admin@example.com", coverage: "PARTIAL" }],
    senderDomain: { senderConfigured: "yes", senderDomain: "example.com", domainMatches: null, comparisonEstablished: false },
  };
  assert.equal(validateSnapshot(fullAddress).ok, false, "full address in senderDomain must reject");
});

test("validator: v5 payload missing a v5 section is invalid (old schemas unaffected)", () => {
  const payload = {
    ...base(5),
    plugins: fullInventory(),
    theme: null,
    woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: false, active: false, version: null, pro: { installed: false, active: false, version: null }, status: "NOT_INSTALLED" },
    environment: { phpMemoryLimit: null, wpMemoryLimit: null, maxExecutionTime: null },
    contactForms: [],
    // mailTransport + senderDomain omitted
  };
  assert.equal(validateSnapshot(payload).ok, false);
});
