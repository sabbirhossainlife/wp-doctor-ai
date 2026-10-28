// Runs a prisma CLI command with DATABASE_URL loaded from .env.local.
// Usage: node scripts/run-prisma.mjs migrate dev --name init_m3_scans
//        TEST_DATABASE_URL override: node scripts/run-prisma.mjs migrate deploy
// Never prints environment values. With the "use-test-db" flag as first arg,
// DATABASE_URL is set from TEST_DATABASE_URL instead.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let useTest = false;
if (args[0] === "use-test-db") {
  useTest = true;
  args.shift();
}
const envFile = readFileSync(path.join(root, ".env.local"), "utf8");
const get = (key) => {
  const m =
    envFile.match(new RegExp(`^${key}="([^"]+)"$`, "m")) ||
    envFile.match(new RegExp(`^${key}=(\\S+)$`, "m"));
  return m ? m[1] : "";
};
const databaseUrl = useTest ? get("TEST_DATABASE_URL") : get("DATABASE_URL");
if (!databaseUrl) {
  console.error("Required database URL is missing from .env.local. Refusing to run prisma.");
  process.exit(1);
}
const engines = `${root}/prisma-engines`;
const result = spawnSync("npx", ["prisma", ...args], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PRISMA_SCHEMA_ENGINE_BINARY: `${engines}/schema-engine`,
    PRISMA_QUERY_ENGINE_BINARY: `${engines}/query-engine`,
    PRISMA_QUERY_ENGINE_LIBRARY: `${engines}/libquery_engine.so.node`,
  },
});
process.exit(result.status ?? 1);
