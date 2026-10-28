import test from "node:test";
import assert from "node:assert/strict";
import { parseScanTarget } from "../lib/scanner/url-policy.js";

test("accepts valid http and https URLs and normalizes them", () => {
  const a = parseScanTarget("HTTP://Example.COM/Path/");
  assert.equal(a.protocol, "http:");
  assert.equal(a.hostname, "example.com");
  assert.equal(a.port, 80);
  const b = parseScanTarget("https://example.com:443/a?b=1#frag");
  assert.equal(b.port, 443);
  assert.equal(b.path, "/a?b=1"); // fragment dropped
});

test("rejects missing, empty, malformed, and relative URLs", () => {
  for (const bad of [null, undefined, 42, "", "   ", "not a url", "://x", "/relative/path", "example.com/path"]) {
    assert.throws(() => parseScanTarget(bad), (e) => e.code === "INVALID_URL");
  }
});

test("rejects unsupported schemes", () => {
  for (const bad of [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "gopher://example.com/",
    "data:text/html,hi",
    "javascript:alert(1)",
    "dict://example.com/",
  ]) {
    assert.throws(() => parseScanTarget(bad), (e) => e.code === "UNSUPPORTED_SCHEME");
  }
});

test("rejects embedded credentials", () => {
  assert.throws(() => parseScanTarget("https://user:pass@example.com/"), (e) => e.code === "INVALID_URL");
  assert.throws(() => parseScanTarget("https://user@example.com/"), (e) => e.code === "INVALID_URL");
});

test("rejects unsupported ports (only 80/443)", () => {
  for (const bad of ["http://example.com:8080/", "https://example.com:8443/", "http://example.com:443/", "https://example.com:80/"]) {
    assert.throws(() => parseScanTarget(bad), (e) => e.code === "UNSUPPORTED_PORT");
  }
  // Explicit default ports are fine.
  assert.equal(parseScanTarget("http://example.com:80/").port, 80);
  assert.equal(parseScanTarget("https://example.com:443/").port, 443);
});

test("normalizes hostname case, trailing dots, and IDNs", () => {
  assert.equal(parseScanTarget("https://EXAMPLE.com./").hostname, "example.com");
  const idn = parseScanTarget("https://münchen.example/");
  assert.ok(idn.hostname.startsWith("xn--"), idn.hostname);
});

test("canonicalizes IPv4 literals (incl. hex/decimal/short forms)", () => {
  assert.equal(parseScanTarget("http://0x7f000001/").hostname, "127.0.0.1");
  assert.equal(parseScanTarget("http://2130706433/").hostname, "127.0.0.1");
  assert.equal(parseScanTarget("http://127.1/").hostname, "127.0.0.1");
  assert.equal(parseScanTarget("http://[::1]/").hostname, "::1");
  assert.equal(parseScanTarget("http://[::1]/").isIpLiteral, true);
});

test("rejects invalid hostnames and refused suffixes", () => {
  for (const bad of [
    "http://foo_bar.com/",
    "http://-bad.example/",
    "http://localhost/",
    "http://foo.localhost/",
    "http://intranet/", // single-label
    "http://example.local/",
    "http://example.internal/",
  ]) {
    assert.throws(() => parseScanTarget(bad), (e) => ["INVALID_URL", "PROHIBITED_DESTINATION"].includes(e.code), bad);
  }
});

test("rejects encoded and ambiguous input", () => {
  assert.throws(() => parseScanTarget("https://exa mple.com/"), (e) => e.code === "INVALID_URL");
  const overlong = `https://example.com/${"a".repeat(3000)}`;
  assert.throws(() => parseScanTarget(overlong), (e) => e.code === "INVALID_URL");
});

test("redirect targets parse relative to a base", () => {
  const t = parseScanTarget("/next/page", "https://example.com/start");
  assert.equal(t.hostname, "example.com");
  assert.equal(t.path, "/next/page");
  assert.throws(() => parseScanTarget("ftp://example.com/", "https://example.com/"), (e) => e.code === "UNSUPPORTED_SCHEME");
});
