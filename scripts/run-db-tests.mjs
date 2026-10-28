// Runs tests/db.test.js with DATABASE_URL taken from TEST_DATABASE_URL in
// .env.local (never printed). Exits non-zero if the test DB URL is missing.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let testUrl = process.env.TEST_DATABASE_URL ?? "";
if (!testUrl) {
  try {
    const env = readFileSync(path.join(root, ".env.local"), "utf8");
    const match = env.match(/^TEST_DATABASE_URL="([^"]+)"$/m) || env.match(/^TEST_DATABASE_URL=(\S+)$/m);
    if (match) testUrl = match[1];
  } catch { /* no .env.local */ }
}
if (!testUrl) {
  console.error("TEST_DATABASE_URL is not set (expected in .env.local). Refusing to run DB tests.");
  process.exit(1);
}
const child = spawn("node", ["--test", "tests/db.test.js", "tests/scans.test.js", "tests/ai-db.test.js", "tests/connector.test.js", "tests/conflict-db.test.js", "tests/conflict-connector.test.js", "tests/woocommerce-db.test.js", "tests/elementor-db.test.js", "tests/speed-db.test.js", "tests/ssl-db.test.js", "tests/contact-email-db.test.js", "tests/security-db.test.js", "tests/malware-db.test.js", "tests/backup-db.test.js", "tests/seo-db.test.js", "tests/uptime-db.test.js"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl },
});
child.on("exit", (code) => process.exit(code ?? 1));
