// Tool 12 maintenance detection + window rules (Milestone 16).
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectMaintenance,
  isValidTimezone,
  validateWindowInput,
  isWindowActive,
  findActiveWindow,
} from "../lib/uptime/maintenance.js";

const PHRASE = "Briefly unavailable for scheduled maintenance. Check back in a minute.";

test("uptime maintenance: recognised WP signature on 503 is observed", () => {
  assert.deepEqual(
    detectMaintenance({ httpStatus: 503, headPrefix: `<html><title>${PHRASE}</title></html>` }),
    { observed: true, indicator: "OBSERVED" },
  );
});

test("uptime maintenance: generic 503 without the phrase is not maintenance", () => {
  assert.deepEqual(
    detectMaintenance({ httpStatus: 503, headPrefix: "<html>Internal Server Error</html>" }),
    { observed: false, indicator: "NOT_OBSERVED" },
  );
});

test("uptime maintenance: phrase without 503 is not maintenance; missing prefix is insufficient", () => {
  assert.equal(detectMaintenance({ httpStatus: 200, headPrefix: PHRASE }).observed, false);
  assert.equal(detectMaintenance({ httpStatus: 503, headPrefix: null }).indicator, "INSUFFICIENT_EVIDENCE");
  assert.equal(detectMaintenance({ httpStatus: 503, headPrefix: null }).observed, false);
});

test("uptime maintenance: disabled detection reports NOT_CHECKED", () => {
  assert.equal(detectMaintenance({ httpStatus: 503, headPrefix: PHRASE, enabled: false }).indicator, "NOT_CHECKED");
});

test("uptime maintenance: timezone validation", () => {
  assert.equal(isValidTimezone("Asia/Dhaka"), true);
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("Not/AZone"), false);
  assert.equal(isValidTimezone(""), false);
  assert.equal(isValidTimezone(null), false);
});

test("uptime maintenance: window validation — end after start, max 14 days, recurrence rejected", () => {
  const base = { title: "Deploy", startAt: "2026-11-01T00:00:00.000Z", endAt: "2026-11-01T02:00:00.000Z", timezone: "Asia/Dhaka" };
  assert.deepEqual(validateWindowInput(base).errors, {});
  assert.ok(validateWindowInput({ ...base, endAt: base.startAt }).errors.endAt);
  assert.ok(validateWindowInput({ ...base, endAt: "2026-11-20T00:00:00.000Z" }).errors.endAt);
  assert.ok(validateWindowInput({ ...base, timezone: "Bogus/Zone" }).errors.timezone);
  assert.ok(validateWindowInput({ ...base, recurrence: "WEEKLY" }).errors.recurrence);
  assert.ok(validateWindowInput({ ...base, title: "" }).errors.title);
});

test("uptime maintenance: window active range is [start, end)", () => {
  const window = { status: "ACTIVE", startAt: new Date("2026-11-01T00:00:00.000Z"), endAt: new Date("2026-11-01T02:00:00.000Z") };
  assert.equal(isWindowActive(window, Date.parse("2026-11-01T01:00:00.000Z")), true);
  assert.equal(isWindowActive(window, Date.parse("2026-11-01T00:00:00.000Z")), true);
  assert.equal(isWindowActive(window, Date.parse("2026-11-01T02:00:00.000Z")), false);
  assert.equal(isWindowActive({ ...window, status: "CANCELLED" }, Date.parse("2026-11-01T01:00:00.000Z")), false);
  assert.equal(findActiveWindow([window], Date.parse("2026-11-01T01:00:00.000Z")), window);
  assert.equal(findActiveWindow([window], Date.parse("2026-11-02T01:00:00.000Z")), null);
});
