// Milestone 6 connector integration tests (run via scripts/run-db-tests.mjs).
// Old + new schema both accepted by storeSnapshot; wrong-connection and
// revoked cases rejected; unexpected inventory fields rejected.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { validateSnapshot } from "../lib/connector/validate-snapshot.js";
import { hashSecret, generateConnectorCredential } from "../lib/connector/crypto.js";
import { storeSnapshot, verifyConnectorRequest } from "../lib/connector/service.js";

const RUN = `cc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let user, website, connection;
// Credential generated at runtime (never a literal in this file).
const CREDENTIAL = generateConnectorCredential();

function v1Payload() {
  return {
    schemaVersion: 1, wordpressVersion: "6.8", phpVersion: "8.3",
    homeUrl: `https://${RUN}.example.com`, siteUrl: `https://${RUN}.example.com`, pluginVersion: "1.0.0",
    activePlugins: [{ name: "Old", version: "1.0" }], activeTheme: { name: "T", version: "1.0" },
    multisite: false, locale: "en_US",
  };
}
function v2Payload() {
  const p = v1Payload();
  return {
    ...p, schemaVersion: 2, pluginVersion: "1.1.0",
    plugins: [{
      name: "Old", slug: "old", version: "1.0", active: true, networkActive: false,
      muPlugin: false, requiresWP: "6.0", requiresPHP: "7.4", dependencies: [],
      updateAvailable: false, newVersion: null, updateCheckedAt: null,
    }],
    theme: { name: "T", version: "1.0", parentName: null, parentVersion: null, requiresWP: null, requiresPHP: null },
  };
}

test("conflict connector: setup", async () => {
  user = await prisma.user.create({ data: { name: "CC Tester", email: `${RUN}@example.invalid` } });
  website = await prisma.website.create({
    data: { name: "Site", normalizedUrl: `https://${RUN}.example.com`, userId: user.id, connectionStatus: "CONNECTED" },
  });
  connection = await prisma.websiteConnection.create({
    data: { websiteId: website.id, status: "ACTIVE", credentialHash: hashSecret(CREDENTIAL) },
  });
  // Reload with website relation, as storeSnapshot expects connection.website.
  connection = await prisma.websiteConnection.findUnique({ where: { id: connection.id }, include: { website: true } });
  assert.ok(connection.website);
});

test("conflict connector: v1 snapshot stores; v2 snapshot replaces it (latest-only)", async () => {
  const r1 = await storeSnapshot({ connection, payload: v1Payload() });
  assert.equal(r1.ok, true);
  let rows = await prisma.connectorDiagnosticSnapshot.findMany({ where: { connectionId: connection.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].schemaVersion, 1);
  const r2 = await storeSnapshot({ connection, payload: v2Payload() });
  assert.equal(r2.ok, true);
  rows = await prisma.connectorDiagnosticSnapshot.findMany({ where: { connectionId: connection.id } });
  assert.equal(rows.length, 1, "latest-only: old snapshot replaced");
  assert.equal(rows[0].schemaVersion, 2);
  assert.equal(rows[0].payload.plugins[0].slug, "old");
});

test("conflict connector: invalid payload rejected; unexpected inventory field rejected", async () => {
  const bad = v2Payload();
  bad.plugins = [{ ...bad.plugins[0], settings: { foo: "bar" } }];
  assert.equal(validateSnapshot(bad).ok, false);
  const stored = await storeSnapshot({ connection, payload: bad });
  assert.equal(stored.ok, false);
  assert.equal(stored.error, "INVALID_DIAGNOSTIC_PAYLOAD");
  const rows = await prisma.connectorDiagnosticSnapshot.findMany({ where: { connectionId: connection.id } });
  assert.equal(rows[0].schemaVersion, 2, "rejected payload did not replace the stored snapshot");
});

test("conflict connector: wrong-connection snapshot rejected (identity mismatch)", async () => {
  const other = await prisma.website.create({
    data: { name: "Other", normalizedUrl: `https://other-${RUN}.example.com`, userId: user.id },
  });
  const otherConn = await prisma.websiteConnection.create({
    data: { websiteId: other.id, status: "ACTIVE", credentialHash: hashSecret("other-cred") },
    include: { website: true },
  });
  // Payload claims the first site's URLs but arrives on the other connection.
  const r = await storeSnapshot({ connection: otherConn, payload: v2Payload() });
  assert.equal(r.ok, false);
  assert.equal(r.error, "SITE_IDENTITY_MISMATCH");
  await prisma.websiteConnection.delete({ where: { id: otherConn.id } });
  await prisma.website.delete({ where: { id: other.id } });
});

test("conflict connector: revoked connector rejected at auth", async () => {
  await prisma.websiteConnection.update({ where: { id: connection.id }, data: { status: "REVOKED" } });
  const ts = String(Math.floor(Date.now() / 1000));
  const r = await verifyConnectorRequest({ authorization: `Bearer ${CREDENTIAL}`, timestamp: ts, nonce: `cc-nonce-${RUN}` });
  assert.equal(r.ok, false);
  assert.equal(r.error, "CONNECTOR_REVOKED");
  await prisma.websiteConnection.update({ where: { id: connection.id }, data: { status: "ACTIVE" } });
});

test("conflict connector: cleanup", async () => {
  await prisma.user.delete({ where: { id: user.id } });
  assert.equal(await prisma.connectorDiagnosticSnapshot.count({ where: { connectionId: connection.id } }), 0);
});
