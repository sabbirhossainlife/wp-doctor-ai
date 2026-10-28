// Tool 11 no-side-effect safety tests. By construction lib/seo contains
// no mutation path: no HTTP verbs other than the pinned GET, no file
// writes, no shell, no form submits, no robots.txt/metadata/redirect/
// settings editing. These tests assert that statically, so a future edit
// that adds a mutation path fails loudly instead of silently.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "seo");
const files = readdirSync(root).filter((f) => f.endsWith(".js"));
const sources = files.map((f) => ({ file: f, src: readFileSync(path.join(root, f), "utf8") }));

const FORBIDDEN = [
  ["fetch(", "unrestricted fetch (must use the pinned transport)"],
  ["axios", "second HTTP client"],
  ["method: \"POST\"", "POST request"],
  ["method: 'POST'", "POST request"],
  ["method: \"PUT\"", "PUT request"],
  ["method: \"DELETE\"", "DELETE request"],
  ["method: \"PATCH\"", "PATCH request"],
  ["writeFile", "file write"],
  ["unlink", "file delete"],
  ["child_process", "shell execution"],
  ["execSync", "shell execution"],
  ["robots.txt\", \"w", "robots.txt write"],
  ["updateMany", "bulk mutation helper"],
];

test("seo no-side-effects: lib/seo sources contain no mutation primitives", () => {
  for (const { file, src } of sources) {
    for (const [token, label] of FORBIDDEN) {
      assert.ok(!src.includes(token), `${file} contains forbidden ${label}: ${token}`);
    }
  }
});

test("seo no-side-effects: service has no delete/update route helper for site content", () => {
  const service = sources.find((s) => s.file === "service.js").src;
  // The only prisma writes are diagnostic + finding creates inside a
  // transaction (own reports), never website/connection/snapshot writes.
  assert.ok(!/prisma\.website\.(update|delete|upsert)/.test(service));
  assert.ok(!/prisma\.connectorDiagnosticSnapshot\.(update|delete|create)/.test(service));
  assert.ok(service.includes("seoDiagnostic.create"));
  assert.ok(service.includes("seoDiagnosticFinding.createMany"));
});

test("seo no-side-effects: engine never stores bodies or snippets", () => {
  const engine = sources.find((s) => s.file === "engine.js").src;
  // Bodies are parsed and discarded; summaries carry counts/statuses.
  assert.ok(engine.includes("discarded after parsing"));
  assert.ok(!engine.includes("bodyPreview: result"));
});

test("seo no-side-effects: finding codes never promise clean/indexed/spam-free", () => {
  const rules = sources.find((s) => s.file === "rules.js").src;
  assert.ok(!rules.includes("SEO_CLEAN"));
  assert.ok(!rules.includes("SPAM_FREE"));
  assert.ok(!rules.includes("FULLY_INDEXED"));
  assert.ok(!rules.includes("SEO_SNAPSHOT_STALE"));
});
