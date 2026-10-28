// Tool 08 version + range matching tests (Milestone 12).
import test from "node:test";
import assert from "node:assert/strict";
import { matchVersionRange, deriveFixedVersion, isStandardVersion } from "../lib/security/versions.js";

test("standard versions recognised; prerelease/dev/nonstandard are not", () => {
  assert.equal(isStandardVersion("7.1.3"), true);
  assert.equal(isStandardVersion("11.2.1"), true);
  assert.equal(isStandardVersion("6.8"), true);
  assert.equal(isStandardVersion("1.0-beta1"), false);
  assert.equal(isStandardVersion("1.0-dev"), false);
  assert.equal(isStandardVersion(""), false);
  assert.equal(isStandardVersion(null), false);
  assert.equal(isStandardVersion("1.0.0+build"), false);
});

test("lt / le / gt / ge / eq boundaries", () => {
  const lt = { min_version: null, min_operator: null, max_version: "3.1.5", max_operator: "lt" };
  assert.equal(matchVersionRange("3.1.4", lt).matched, true);
  assert.equal(matchVersionRange("3.1.5", lt).matched, false);
  const le = { min_version: null, min_operator: null, max_version: "3.1.4", max_operator: "le" };
  assert.equal(matchVersionRange("3.1.4", le).matched, true);
  assert.equal(matchVersionRange("3.1.5", le).matched, false);
  const range = { min_version: "2.5.0", min_operator: "ge", max_version: "3.1.4", max_operator: "le" };
  assert.equal(matchVersionRange("2.5.0", range).matched, true);
  assert.equal(matchVersionRange("2.4.9", range).matched, false);
  assert.equal(matchVersionRange("3.1.5", range).matched, false);
  const gt = { min_version: "1.0", min_operator: "gt", max_version: null, max_operator: null };
  assert.equal(matchVersionRange("1.0", gt).matched, false);
  assert.equal(matchVersionRange("1.0.1", gt).matched, true);
  const eq = { min_version: null, min_operator: null, max_version: "2.0", max_operator: "eq" };
  assert.equal(matchVersionRange("2.0", eq).matched, true);
  assert.equal(matchVersionRange("2.0.1", eq).matched, false);
});

test("numeric (not lexicographic) comparison: 10.0 > 9.0", () => {
  const lt = { min_version: null, min_operator: null, max_version: "10.0", max_operator: "lt" };
  assert.equal(matchVersionRange("9.0", lt).matched, true);
  assert.equal(matchVersionRange("10.0", lt).matched, false);
});

test("prerelease installed version -> insufficient, never matched, never cleared", () => {
  const lt = { min_version: null, min_operator: null, max_version: "3.1.5", max_operator: "lt" };
  const r = matchVersionRange("3.1.4-beta1", lt);
  assert.equal(r.insufficient, true);
  assert.equal(r.matched, undefined);
});

test("unsupported operators and missing bounds -> insufficient", () => {
  assert.equal(matchVersionRange("1.0", { min_version: null, min_operator: null, max_version: "2.0", max_operator: "ne" }).insufficient, true);
  assert.equal(matchVersionRange("1.0", { min_version: null, min_operator: null, max_version: null, max_operator: null }).insufficient, true);
  assert.equal(matchVersionRange("1.0", null).insufficient, true);
  assert.equal(matchVersionRange("1.0", { min_version: "x", min_operator: "ge", max_version: null, max_operator: null }).insufficient, true);
});

test("fixed version derivation: lt only, never for le/eq/unfixed", () => {
  assert.equal(deriveFixedVersion({ max_version: "3.1.5", max_operator: "lt", unfixed: "0" }), "3.1.5");
  assert.equal(deriveFixedVersion({ max_version: "3.1.4", max_operator: "le", unfixed: "0" }), null);
  assert.equal(deriveFixedVersion({ max_version: "2.0", max_operator: "eq", unfixed: "0" }), null);
  assert.equal(deriveFixedVersion({ max_version: "3.1.5", max_operator: "lt", unfixed: "1" }), null);
  assert.equal(deriveFixedVersion(null), null);
});
