import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { generatePairingCode, generateConnectorCredential, hashSecret } from "../lib/connector/crypto.js";
import { canonicalizeSiteUrl, siteIdentityMatches } from "../lib/connector/identity.js";
import { validateSnapshot } from "../lib/connector/validate-snapshot.js";
import {
  createPairingIntent,
  consumePairing,
  verifyConnectorRequest,
  storeSnapshot,
  revokeConnection,
} from "../lib/connector/service.js";

const RUN = `ct-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA;
let userB;

async function makeUser(suffix) {
  return prisma.user.create({
    data: { name: "Connector Tester", email: `${RUN}-${suffix}@example.invalid` },
  });
}

async function makeWebsite(userId, normalizedUrl) {
  return prisma.website.create({
    data: { name: "Test Site", normalizedUrl, userId },
  });
}

test("connector setup: users", async () => {
  userA = await makeUser("a");
  userB = await makeUser("b");
  assert.ok(userA.id && userB.id);
});

test("crypto: pairing codes are high-entropy and hashed, never stored raw", () => {
  const a = generatePairingCode();
  const b = generatePairingCode();
  assert.equal(a.length, 32);
  assert.match(a, /^[a-z2-7]{32}$/);
  assert.notEqual(a, b);
  assert.equal(hashSecret(a), hashSecret(a));
  assert.notEqual(hashSecret(a), a);
  const cred = generateConnectorCredential();
  assert.equal(cred.length, 43);
  assert.notEqual(hashSecret(cred), cred);
});

test("identity: canonicalization drops query/fragment/ports/case, keeps path", () => {
  assert.equal(canonicalizeSiteUrl("https://EXAMPLE.com:443/blog/?x=1#frag"), "https://example.com/blog");
  assert.equal(canonicalizeSiteUrl("http://example.com:80/"), "http://example.com");
  assert.equal(canonicalizeSiteUrl("http://example.com:8080/"), "http://example.com:8080");
  assert.equal(canonicalizeSiteUrl("https://user:pass@example.com/"), null);
  assert.equal(canonicalizeSiteUrl("ftp://example.com/"), null);
  assert.equal(canonicalizeSiteUrl("not a url"), null);
});

test("identity: subdirectory installs match on either claimed URL", () => {
  // Registered home is the subdirectory; claimed site is the WP core dir.
  assert.equal(siteIdentityMatches("https://example.com/blog", "https://example.com/blog/", "https://example.com"), true);
  // Registered home is root; claimed site is a subdirectory core install.
  assert.equal(siteIdentityMatches("https://example.com", "https://example.com", "https://example.com/wp"), true);
  assert.equal(siteIdentityMatches("https://example.com/blog", "https://example.com/other", "https://example.com"), false);
  assert.equal(siteIdentityMatches("https://example.com", "https://evil.example.com", "https://example.com.evil.com"), false);
});

test("snapshot validation: allowlist only, prohibited fields rejected", () => {
  const valid = {
    schemaVersion: 1,
    wordpressVersion: "6.8",
    phpVersion: "8.3.1",
    homeUrl: "https://example.com",
    siteUrl: "https://example.com",
    pluginVersion: "1.0.0",
    activePlugins: [{ name: "Akismet", version: "5.3" }],
    activeTheme: { name: "Twenty Twenty-Five", version: "1.0" },
    multisite: false,
    locale: "en_US",
  };
  assert.equal(validateSnapshot(valid).ok, true);
  assert.equal(validateSnapshot({ ...valid, adminEmail: "a@b.c" }).ok, false);
  assert.equal(validateSnapshot({ ...valid, extra: 1 }).ok, false);
  assert.equal(validateSnapshot({ ...valid, activePlugins: [{ name: "X", version: "1", email: "a@b.c" }] }).ok, false);
  assert.equal(validateSnapshot({ ...valid, schemaVersion: 2 }).ok, false);
  assert.equal(validateSnapshot({ ...valid, wordpressVersion: "" }).ok, false);
  assert.equal(validateSnapshot(null).ok, false);
  const minimized = validateSnapshot(valid).snapshot;
  assert.deepEqual(Object.keys(minimized).sort(), Object.keys(valid).sort());
});

test("pairing intent: creation, ownership, single live code per website", async () => {
  const site = await makeWebsite(userA.id, "https://intent-a.example.com");
  const first = await createPairingIntent({ userId: userA.id, websiteId: site.id });
  assert.equal(first.ok, true);
  assert.equal(first.code.length, 32);
  assert.ok(first.expiresAt > new Date());
  const stored = await prisma.connectorPairingIntent.findFirst({ where: { websiteId: site.id } });
  assert.equal(stored.status, "PENDING");
  assert.notEqual(stored.codeHash, first.code);
  assert.equal(stored.codeHash, hashSecret(first.code));
  // Wrong owner cannot create an intent for this website.
  const wrongOwner = await createPairingIntent({ userId: userB.id, websiteId: site.id });
  assert.equal(wrongOwner.error, "NOT_FOUND");
  // A second intent revokes the first pending one.
  const second = await createPairingIntent({ userId: userA.id, websiteId: site.id });
  assert.equal(second.ok, true);
  const firstAfter = await prisma.connectorPairingIntent.findFirst({ where: { id: stored.id } });
  assert.equal(firstAfter.status, "REVOKED");
  const revokedConsume = await consumePairing({
    code: first.code,
    homeUrl: "https://intent-a.example.com",
    siteUrl: "https://intent-a.example.com",
    pluginVersion: "1.0.0",
  });
  assert.equal(revokedConsume.error, "PAIRING_CODE_INVALID");
});

test("pairing: success creates an ACTIVE connection and CONNECTED website", async () => {
  const site = await makeWebsite(userA.id, "https://pair-ok.example.com");
  const intent = await createPairingIntent({ userId: userA.id, websiteId: site.id });
  const result = await consumePairing({
    code: intent.code,
    homeUrl: "https://pair-ok.example.com/",
    siteUrl: "https://pair-ok.example.com",
    pluginVersion: "1.0.0",
  });
  assert.equal(result.ok, true);
  assert.equal(result.credential.length, 43);
  const connection = await prisma.websiteConnection.findFirst({ where: { websiteId: site.id } });
  assert.equal(connection.status, "ACTIVE");
  assert.notEqual(connection.credentialHash, result.credential);
  assert.equal(connection.credentialHash, hashSecret(result.credential));
  const siteAfter = await prisma.website.findFirst({ where: { id: site.id } });
  assert.equal(siteAfter.connectionStatus, "CONNECTED");
  const intentAfter = await prisma.connectorPairingIntent.findFirst({
    where: { codeHash: hashSecret(intent.code) },
  });
  assert.equal(intentAfter.status, "CONSUMED");
  // Reuse is rejected.
  const reuse = await consumePairing({
    code: intent.code,
    homeUrl: "https://pair-ok.example.com",
    siteUrl: "https://pair-ok.example.com",
    pluginVersion: "1.0.0",
  });
  assert.equal(reuse.error, "PAIRING_CODE_ALREADY_USED");
});

test("pairing: identity mismatch increments attempts; expired code rejected", async () => {
  const site = await makeWebsite(userA.id, "https://pair-mismatch.example.com");
  const intent = await createPairingIntent({ userId: userA.id, websiteId: site.id });
  const mismatch = await consumePairing({
    code: intent.code,
    homeUrl: "https://other.example.com",
    siteUrl: "https://other.example.com",
    pluginVersion: "1.0.0",
  });
  assert.equal(mismatch.error, "SITE_IDENTITY_MISMATCH");
  const after = await prisma.connectorPairingIntent.findFirst({ where: { id: (await prisma.connectorPairingIntent.findFirst({ where: { codeHash: hashSecret(intent.code) } })).id } });
  assert.equal(after.attemptCount, 1);

  const site2 = await makeWebsite(userA.id, "https://pair-expired.example.com");
  const intent2 = await createPairingIntent({ userId: userA.id, websiteId: site2.id });
  await prisma.connectorPairingIntent.updateMany({
    where: { websiteId: site2.id, status: "PENDING" },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const expired = await consumePairing({
    code: intent2.code,
    homeUrl: "https://pair-expired.example.com",
    siteUrl: "https://pair-expired.example.com",
    pluginVersion: "1.0.0",
  });
  assert.equal(expired.error, "PAIRING_CODE_EXPIRED");
});

test("pairing: attempt cap blocks even a later correct attempt", async () => {
  const site = await makeWebsite(userA.id, "https://pair-cap.example.com");
  const intent = await createPairingIntent({ userId: userA.id, websiteId: site.id });
  for (let i = 0; i < 5; i++) {
    const r = await consumePairing({
      code: intent.code,
      homeUrl: "https://wrong.example.com",
      siteUrl: "https://wrong.example.com",
      pluginVersion: "1.0.0",
    });
    assert.equal(r.error, "SITE_IDENTITY_MISMATCH");
  }
  const correctAfterCap = await consumePairing({
    code: intent.code,
    homeUrl: "https://pair-cap.example.com",
    siteUrl: "https://pair-cap.example.com",
    pluginVersion: "1.0.0",
  });
  assert.equal(correctAfterCap.error, "PAIRING_CODE_INVALID");
});

test("pairing: concurrent attempts yield exactly one success", async () => {
  const site = await makeWebsite(userA.id, "https://pair-race.example.com");
  const intent = await createPairingIntent({ userId: userA.id, websiteId: site.id });
  const input = {
    code: intent.code,
    homeUrl: "https://pair-race.example.com",
    siteUrl: "https://pair-race.example.com",
    pluginVersion: "1.0.0",
  };
  const [r1, r2] = await Promise.all([consumePairing(input), consumePairing(input)]);
  const successes = [r1, r2].filter((r) => r.ok);
  assert.equal(successes.length, 1);
  assert.equal([r1, r2].filter((r) => r.error === "PAIRING_CODE_ALREADY_USED").length, 1);
});

async function pairSite(url) {
  const site = await makeWebsite(userA.id, url);
  const intent = await createPairingIntent({ userId: userA.id, websiteId: site.id });
  const result = await consumePairing({
    code: intent.code,
    homeUrl: url,
    siteUrl: url,
    pluginVersion: "1.0.0",
  });
  assert.equal(result.ok, true);
  return { site, credential: result.credential };
}

function validSnapshot(homeUrl) {
  return {
    schemaVersion: 1,
    wordpressVersion: "6.8",
    phpVersion: "8.3.1",
    homeUrl,
    siteUrl: homeUrl,
    pluginVersion: "1.0.0",
    activePlugins: [{ name: "Akismet", version: "5.3" }],
    activeTheme: { name: "Twenty Twenty-Five", version: "1.0" },
    multisite: false,
    locale: "en_US",
  };
}

function authHeaders(credential, nonce, secondsOffset = 0) {
  return {
    authorization: `Bearer ${credential}`,
    timestamp: String(Math.floor(Date.now() / 1000) + secondsOffset),
    nonce,
  };
}

test("diagnostics: authenticated snapshot stored, latest-only, lastSyncAt updated", async () => {
  const { site, credential } = await pairSite("https://diag-ok.example.com");
  const auth = await verifyConnectorRequest(authHeaders(credential, `nonce-diag-${RUN}`));
  assert.equal(auth.ok, true);
  const stored = await storeSnapshot({ connection: auth.connection, payload: validSnapshot("https://diag-ok.example.com") });
  assert.equal(stored.ok, true);
  const rows = await prisma.connectorDiagnosticSnapshot.findMany({ where: { connectionId: auth.connection.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].websiteId, site.id);
  assert.deepEqual(Object.keys(rows[0].payload).sort(), Object.keys(validSnapshot("https://diag-ok.example.com")).sort());
  const connAfter = await prisma.websiteConnection.findFirst({ where: { id: auth.connection.id } });
  assert.ok(connAfter.lastSyncAt);
  // A second snapshot replaces the first (bounded latest-snapshot model).
  const auth2 = await verifyConnectorRequest(authHeaders(credential, `nonce-diag2-${RUN}`));
  await storeSnapshot({ connection: auth2.connection, payload: validSnapshot("https://diag-ok.example.com") });
  const rows2 = await prisma.connectorDiagnosticSnapshot.findMany({ where: { connectionId: auth.connection.id } });
  assert.equal(rows2.length, 1);
});

test("diagnostics: replay, timestamps, bad credentials, identity mismatch rejected", async () => {
  const { credential } = await pairSite("https://diag-sec.example.com");
  const nonce = `nonce-replay-${RUN}`;
  const first = await verifyConnectorRequest(authHeaders(credential, nonce));
  assert.equal(first.ok, true);
  const replay = await verifyConnectorRequest(authHeaders(credential, nonce));
  assert.equal(replay.error, "REQUEST_REPLAYED");
  const [c1, c2] = await Promise.all([
    verifyConnectorRequest(authHeaders(credential, `nonce-race-${RUN}`)),
    verifyConnectorRequest(authHeaders(credential, `nonce-race-${RUN}`)),
  ]);
  assert.equal([c1, c2].filter((r) => r.ok).length, 1);
  assert.equal([c1, c2].filter((r) => r.error === "REQUEST_REPLAYED").length, 1);
  const expired = await verifyConnectorRequest(authHeaders(credential, `nonce-old-${RUN}`, -3600));
  assert.equal(expired.error, "REQUEST_TIMESTAMP_INVALID");
  const future = await verifyConnectorRequest(authHeaders(credential, `nonce-future-${RUN}`, 3600));
  assert.equal(future.error, "REQUEST_TIMESTAMP_INVALID");
  const badCred = await verifyConnectorRequest(authHeaders("bad-credential-value", `nonce-bad-${RUN}`));
  assert.equal(badCred.error, "CONNECTOR_AUTH_FAILED");
  const noBearer = await verifyConnectorRequest({ authorization: null, timestamp: String(Math.floor(Date.now() / 1000)), nonce: `nonce-nb-${RUN}` });
  assert.equal(noBearer.error, "CONNECTOR_AUTH_FAILED");
  // Identity mismatch: snapshot for a different site under this connection.
  const auth3 = await verifyConnectorRequest(authHeaders(credential, `nonce-mismatch-${RUN}`));
  const mismatch = await storeSnapshot({ connection: auth3.connection, payload: validSnapshot("https://different.example.com") });
  assert.equal(mismatch.error, "SITE_IDENTITY_MISMATCH");
  // Unknown-field payload rejected.
  const auth4 = await verifyConnectorRequest(authHeaders(credential, `nonce-unknown-${RUN}`));
  const badPayload = await storeSnapshot({
    connection: auth4.connection,
    payload: { ...validSnapshot("https://diag-sec.example.com"), websiteId: "someone-elses-id" },
  });
  assert.equal(badPayload.error, "INVALID_DIAGNOSTIC_PAYLOAD");
});

test("revocation: wrong owner refused; correct owner revokes; old credential rejected", async () => {
  const { site, credential } = await pairSite("https://diag-revoke.example.com");
  const connection = await prisma.websiteConnection.findFirst({ where: { websiteId: site.id } });
  const wrongOwner = await revokeConnection({ userId: userB.id, connectionId: connection.id });
  assert.equal(wrongOwner.error, "NOT_FOUND");
  const revoked = await revokeConnection({ userId: userA.id, connectionId: connection.id });
  assert.equal(revoked.ok, true);
  const connAfter = await prisma.websiteConnection.findFirst({ where: { id: connection.id } });
  assert.equal(connAfter.status, "REVOKED");
  const siteAfter = await prisma.website.findFirst({ where: { id: site.id } });
  assert.equal(siteAfter.connectionStatus, "NOT_CONNECTED");
  const after = await verifyConnectorRequest(authHeaders(credential, `nonce-after-revoke-${RUN}`));
  assert.equal(after.error, "CONNECTOR_REVOKED");
});

test("connector cleanup: test users cascade", async () => {
  const userAId = userA.id;
  const userBId = userB.id;
  await prisma.user.delete({ where: { id: userAId } });
  await prisma.user.delete({ where: { id: userBId } });
  // Cascade user -> website -> connection/snapshot/intent removes them.
  const remainingWebsites = await prisma.website.findMany({
    where: { userId: { in: [userAId, userBId] } },
  });
  const remainingConnections = await prisma.websiteConnection.findMany({
    where: { website: { userId: { in: [userAId, userBId] } } },
  });
  assert.equal(remainingWebsites.length, 0);
  assert.equal(remainingConnections.length, 0);
});
