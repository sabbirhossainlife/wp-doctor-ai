import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWebsiteUrl, validateWebsiteInput, normalizeEmail, validatePassword } from "../lib/websites.js";

test("normalizes https URL: lowercases host, strips trailing slash", () => {
  assert.equal(normalizeWebsiteUrl("HTTPS://Example.COM/"), "https://example.com");
  assert.equal(normalizeWebsiteUrl("https://example.com:443/blog/"), "https://example.com/blog");
  assert.equal(normalizeWebsiteUrl("http://example.com:80/"), "http://example.com");
  assert.equal(normalizeWebsiteUrl("https://example.com/page#frag"), "https://example.com/page");
});

test("rejects malformed and unsupported URLs", () => {
  assert.equal(normalizeWebsiteUrl("not a url"), null);
  assert.equal(normalizeWebsiteUrl("ftp://example.com"), null);
  assert.equal(normalizeWebsiteUrl("javascript:alert(1)"), null);
  assert.equal(normalizeWebsiteUrl("https://user:pass@example.com"), null);
  assert.equal(normalizeWebsiteUrl(""), null);
  assert.equal(normalizeWebsiteUrl(null), null);
});

test("validateWebsiteInput accepts valid input and flags bad input", () => {
  const ok = validateWebsiteInput({ name: " My Site ", url: "https://Example.com/" });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.name, "My Site");
  assert.equal(ok.normalizedUrl, "https://example.com");
  const bad = validateWebsiteInput({ name: "", url: "ftp://x.com" });
  assert.ok(bad.errors.name && bad.errors.url);
});

test("email normalization and password rules", () => {
  assert.equal(normalizeEmail("  Alice@Example.COM "), "alice@example.com");
  assert.equal(validatePassword("short"), "Password must be at least 8 characters.");
  assert.equal(validatePassword("longenough1"), null);
});
