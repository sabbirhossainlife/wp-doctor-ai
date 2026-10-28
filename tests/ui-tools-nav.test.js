import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_CATEGORIES, ALL_TOOLS, TOOL_HREFS } from "../lib/tools-nav.js";

const EXPECTED_HREFS = [
  "/tools/error-checker",
  "/tools/plugin-theme-checker",
  "/tools/woocommerce-checkout-checker",
  "/tools/elementor-layout-checker",
  "/tools/website-speed-analyzer",
  "/tools/ssl-redirect-checker",
  "/tools/contact-email-checker",
  "/tools/security-scanner",
  "/tools/malware-recovery",
  "/tools/backup-restore-migration",
  "/tools/seo-spam-checker",
  "/tools/uptime-monitor",
];

test("ui nav: all 12 tool routes present exactly once, grouped, none invented", () => {
  assert.equal(ALL_TOOLS.length, 12);
  assert.equal(new Set(TOOL_HREFS).size, 12);
  assert.deepEqual([...TOOL_HREFS].sort(), [...EXPECTED_HREFS].sort());
  assert.ok(TOOL_CATEGORIES.length >= 4);
  for (const category of TOOL_CATEGORIES) {
    assert.ok(category.id && category.label && category.tools.length > 0);
  }
});

test("ui nav: Tool 10 is flagged partial and Tool 12 scheduler-inactive, never ready", () => {
  const backup = ALL_TOOLS.find((t) => t.href === "/tools/backup-restore-migration");
  const uptime = ALL_TOOLS.find((t) => t.href === "/tools/uptime-monitor");
  assert.equal(backup.status, "partial");
  assert.match(backup.statusLabel, /restore\/migration execution blocked/i);
  assert.equal(uptime.status, "scheduler-inactive");
  assert.match(uptime.statusLabel, /scheduler inactive/i);
  for (const tool of ALL_TOOLS) {
    assert.ok(tool.name && tool.short && tool.description && tool.href);
  }
});

test("ui nav: every tool has a distinct short label for the dropdown/drawer", () => {
  const shorts = ALL_TOOLS.map((t) => t.short);
  assert.equal(new Set(shorts).size, 12);
});
