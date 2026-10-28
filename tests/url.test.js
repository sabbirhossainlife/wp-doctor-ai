import test from "node:test";
import assert from "node:assert/strict";
import { isHttpUrl } from "../lib/url.js";

test("isHttpUrl accepts http and https URLs with a host", () => {
  assert.equal(isHttpUrl("https://example.com"), true);
  assert.equal(isHttpUrl("http://example.com/page"), true);
});

test("isHttpUrl rejects non-http schemes, missing hosts and bad input", () => {
  assert.equal(isHttpUrl("ftp://example.com"), false);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("https://"), false);
  assert.equal(isHttpUrl("not a url"), false);
  assert.equal(isHttpUrl(""), false);
  assert.equal(isHttpUrl(null), false);
  assert.equal(isHttpUrl(42), false);
});
