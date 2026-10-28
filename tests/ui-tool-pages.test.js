import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (rel) => readFileSync(join(root, rel), "utf8");

const TOOLS = [
  ["error-checker", "ScanForm"],
  ["plugin-theme-checker", "ConflictCheckerForm"],
  ["woocommerce-checkout-checker", "WooCommerceCheckerForm"],
  ["elementor-layout-checker", "ElementorCheckerForm"],
  ["website-speed-analyzer", "SpeedAnalyzerForm"],
  ["ssl-redirect-checker", "SslRedirectCheckerForm"],
  ["contact-email-checker", "ContactEmailCheckerForm"],
  ["security-scanner", "SecurityScannerForm"],
  ["malware-recovery", "MalwareCheckerForm"],
  ["backup-restore-migration", "BackupToolForms"],
  ["seo-spam-checker", "SeoCheckerForm"],
  ["uptime-monitor", "UptimeMonitorForm"],
];

test("ui tool pages: all 12 pages exist, use the shared header + wide container, keep their form", () => {
  for (const [slug, form] of TOOLS) {
    const rel = `app/tools/${slug}/page.jsx`;
    assert.ok(existsSync(join(root, rel)), `missing ${rel}`);
    const src = read(rel);
    assert.match(src, /PageHeader/, `${rel} lacks PageHeader`);
    assert.match(src, /PageContainer/, `${rel} lacks PageContainer`);
    assert.ok(!src.includes("max-w-3xl"), `${rel} still uses narrow container`);
    assert.ok(src.includes(form), `${rel} lost its ${form} import`);
    assert.match(src, /backHref="\/dashboard"/, `${rel} lacks back-to-dashboard link`);
  }
});

test("ui tool pages: Tool 10 blocked wording and Tool 12 scheduler notice survive verbatim in meaning", () => {
  const backup = read("app/tools/backup-restore-migration/page.jsx");
  assert.match(backup, /What is blocked in this milestone/);
  assert.match(backup, /Live restore and live migration execution/);
  assert.match(backup, /end BLOCKED with no target change/);
  const uptime = read("app/tools/uptime-monitor/page.jsx");
  assert.match(uptime, /Scheduled monitoring inactive: worker not configured\./);
});

test("ui tool pages: homepage headline is exact and homepage + dashboard link the tools", () => {
  const home = read("app/page.jsx");
  assert.ok(
    home.includes("Find out what is wrong with your WordPress site — with evidence."),
    "homepage headline changed",
  );
  assert.ok(home.includes("TOOL_CATEGORIES"));
  const dashboard = read("app/dashboard/page.jsx");
  assert.ok(dashboard.includes("TOOL_CATEGORIES"));
});

test("ui tool pages: no page renders 12 horizontal tool links", () => {
  for (const [slug] of TOOLS) {
    const src = read(`app/tools/${slug}/page.jsx`);
    assert.ok(!src.includes('className="flex items-center gap-5'), `${slug} still has horizontal nav`);
  }
});
