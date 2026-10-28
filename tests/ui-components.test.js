import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("ui components: dropdown is accessible (aria-expanded, aria-haspopup, Escape)", () => {
  const src = read("components/ToolsDropdown.jsx");
  assert.match(src, /aria-expanded/);
  assert.match(src, /aria-haspopup/);
  assert.match(src, /Escape/);
  assert.match(src, /min-h-\[44px\]/);
});

test("ui components: mobile drawer is accessible (Escape, focus return, scroll lock, viewport cap)", () => {
  const src = read("components/MobileNavigationDrawer.jsx");
  assert.match(src, /Escape/);
  assert.match(src, /previouslyFocused/);
  assert.match(src, /overflow.*hidden/);
  assert.match(src, /min-h-\[44px\]/);
  assert.match(src, /w-\[min\(22rem,92vw\)\]/);
  assert.match(src, /aria-modal="true"/);
});

test("ui components: header never renders 12 horizontal tool links", () => {
  const src = read("components/SiteHeader.jsx");
  assert.ok(!src.includes("/tools/error-checker"));
  assert.ok(!src.includes("/tools/uptime-monitor"));
  assert.match(src, /ToolsDropdown/);
  assert.match(src, /MobileNavigationDrawer/);
  assert.match(src, /whitespace-nowrap/);
  // Desktop nav hides below lg; hamburger shows below lg (early switch).
  assert.match(src, /hidden.*lg:flex/);
  assert.match(src, /lg:hidden/);
});

test("ui components: header dropdown + drawer + homepage grid link all 12 routes", () => {
  const dropdown = read("components/ToolsDropdown.jsx");
  const drawer = read("components/MobileNavigationDrawer.jsx");
  assert.ok(dropdown.includes("TOOL_CATEGORIES"));
  assert.ok(drawer.includes("TOOL_CATEGORIES"));
  const home = read("app/page.jsx");
  assert.ok(home.includes("TOOL_CATEGORIES"));
  const dashboard = read("app/dashboard/page.jsx");
  assert.ok(dashboard.includes("TOOL_CATEGORIES"));
});

test("ui components: container is wide (1280px) and globals carry the token palette", () => {
  const container = read("components/PageContainer.jsx");
  assert.match(container, /max-w-\[1280px\]/);
  assert.match(container, /clamp\(16px,3vw,40px\)/);
  const css = read("app/globals.css");
  for (const token of ["#F8FAFC", "#0F172A", "#475569", "#2563EB", "#1D4ED8", "#06B6D4", "#E2E8F0", "#16A34A", "#D97706", "#DC2626"]) {
    assert.ok(css.toLowerCase().includes(token.toLowerCase()), `missing token ${token}`);
  }
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(!css.includes("overflow-x: hidden") && !css.includes("overflow-x:hidden"));
});

test("ui components: StatusIndicator never renders BLOCKED as green success", () => {
  const src = read("components/StatusIndicator.jsx");
  const blockedLine = src.split("\n").find((line) => line.includes("blocked:"));
  assert.ok(blockedLine && !blockedLine.includes("bg-green") && !blockedLine.includes("bg-success"));
  assert.match(src, /never colour alone/i);
});

test("ui components: no forbidden success badges in app/components", () => {
  const forbidden = ["100% Secure", "100% Clean", "Malware-Free"];
  for (const rel of ["app/page.jsx", "app/dashboard/page.jsx", "components/SiteHeader.jsx", "components/ToolCard.jsx"]) {
    const src = read(rel);
    for (const phrase of forbidden) assert.ok(!src.includes(phrase), `${rel} contains ${phrase}`);
  }
});
