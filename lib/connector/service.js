import { prisma } from "../prisma.js";
import {
  generatePairingCode,
  generateConnectorCredential,
  hashSecret,
} from "./crypto.js";
import { siteIdentityMatches } from "./identity.js";
import {
  intentLimiter,
  diagnosticsLimiter,
  CONNECTOR_LIMITS,
} from "./rate-limit.js";
import { validateSnapshot } from "./validate-snapshot.js";

// Bounded error codes for connector APIs (safe messages live in routes).
export const CONNECTOR_ERRORS = Object.freeze({
  PAIRING_CODE_INVALID: "The pairing code is invalid.",
  PAIRING_CODE_EXPIRED: "The pairing code has expired. Generate a new one.",
  PAIRING_CODE_ALREADY_USED: "This pairing code has already been used.",
  SITE_IDENTITY_MISMATCH:
    "The WordPress site address does not match the registered website. Check that you paired the same site you registered, then generate a new code and try again.",
  CONNECTOR_NOT_CONFIGURED: "The connector is not configured.",
  CONNECTOR_REVOKED: "This connection has been revoked. Pair the site again.",
  CONNECTOR_AUTH_FAILED: "Connector authentication failed.",
  REQUEST_TIMESTAMP_INVALID: "The request timestamp is outside the allowed window.",
  REQUEST_REPLAYED: "This request has already been processed.",
  INVALID_DIAGNOSTIC_PAYLOAD: "The diagnostic payload is invalid.",
  REQUEST_TOO_LARGE: "The request is too large.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  DATABASE_OPERATION_FAILED: "Could not complete the operation. Try again.",
});

// --- Pairing intents (session-authenticated; routes enforce ownership) ---

export async function createPairingIntent({ userId, websiteId }) {
  const website = await prisma.website.findFirst({ where: { id: websiteId, userId } });
  if (!website) return { ok: false, error: "NOT_FOUND" };
  if (
    !intentLimiter.check(
      `intent:${websiteId}`,
      CONNECTOR_LIMITS.intentPerWebsitePerHour,
      CONNECTOR_LIMITS.intentWindowMs,
    )
  ) {
    return { ok: false, error: "RATE_LIMITED" };
  }
  // Only one live code per website: revoke older pending intents so a
  // stale code found later cannot pair a different installation.
  await prisma.connectorPairingIntent.updateMany({
    where: { websiteId, status: "PENDING" },
    data: { status: "REVOKED" },
  });
  const code = generatePairingCode();
  const intent = await prisma.connectorPairingIntent.create({
    data: {
      websiteId,
      userId,
      codeHash: hashSecret(code),
      status: "PENDING",
      expiresAt: new Date(Date.now() + CONNECTOR_LIMITS.pairingExpiryMs),
      attemptCount: 0,
    },
  });
  // The raw code is returned ONCE to the caller; it is never stored,
  // logged, or returned again by any endpoint.
  return { ok: true, code, expiresAt: intent.expiresAt, intentId: intent.id };
}

// --- Pairing (code-gated, NOT session-authenticated) ---

export async function consumePairing({ code, homeUrl, siteUrl, pluginVersion }) {
  if (typeof code !== "string" || !code) return { ok: false, error: "PAIRING_CODE_INVALID" };
  const intent = await prisma.connectorPairingIntent.findFirst({
    where: { codeHash: hashSecret(code) },
    include: { website: true },
  });
  if (!intent) return { ok: false, error: "PAIRING_CODE_INVALID" };
  if (intent.status === "CONSUMED") return { ok: false, error: "PAIRING_CODE_ALREADY_USED" };
  if (intent.status !== "PENDING") return { ok: false, error: "PAIRING_CODE_INVALID" };
  if (intent.expiresAt <= new Date()) {
    await prisma.connectorPairingIntent.update({
      where: { id: intent.id },
      data: { status: "EXPIRED" },
    });
    return { ok: false, error: "PAIRING_CODE_EXPIRED" };
  }
  if (intent.attemptCount >= CONNECTOR_LIMITS.pairingMaxAttempts) {
    return { ok: false, error: "PAIRING_CODE_INVALID" };
  }
  if (!siteIdentityMatches(intent.website.normalizedUrl, homeUrl, siteUrl)) {
    await prisma.connectorPairingIntent.update({
      where: { id: intent.id },
      data: { attemptCount: { increment: 1 } },
    });
    return { ok: false, error: "SITE_IDENTITY_MISMATCH" };
  }
  const credential = generateConnectorCredential();
  const credentialHash = hashSecret(credential);
  // Atomic consumption: the status transition only succeeds if the
  // intent is still PENDING, so two concurrent requests cannot both
  // pair with the same code. If the transition loses the race, the
  // whole pairing is rejected (no credential is issued twice).
  const result = await prisma.$transaction(async (tx) => {
    const consumed = await tx.connectorPairingIntent.updateMany({
      where: { id: intent.id, status: "PENDING" },
      data: { status: "CONSUMED", consumedAt: new Date() },
    });
    if (consumed.count !== 1) return null;
    const connection = await tx.websiteConnection.upsert({
      where: { websiteId: intent.websiteId },
      create: {
        websiteId: intent.websiteId,
        status: "ACTIVE",
        credentialHash,
        pairedAt: new Date(),
        pluginVersion: typeof pluginVersion === "string" ? pluginVersion.slice(0, 50) : null,
      },
      update: {
        status: "ACTIVE",
        credentialHash,
        pairedAt: new Date(),
        pluginVersion: typeof pluginVersion === "string" ? pluginVersion.slice(0, 50) : null,
      },
    });
    await tx.website.update({
      where: { id: intent.websiteId },
      data: { connectionStatus: "CONNECTED" },
    });
    return connection;
  });
  if (!result) return { ok: false, error: "PAIRING_CODE_ALREADY_USED" };
  // Raw credential returned ONCE in the pairing response. It is never
  // stored, logged, or shown in the dashboard afterwards.
  return {
    ok: true,
    credential,
    websiteId: intent.websiteId,
    connectionId: result.id,
    pairedAt: result.pairedAt,
  };
}

// --- Connector request authentication (diagnostics) ---

export async function verifyConnectorRequest({ authorization, timestamp, nonce }) {
  const match = typeof authorization === "string" ? authorization.match(/^Bearer\s+(\S+)$/) : null;
  if (!match) return { ok: false, error: "CONNECTOR_AUTH_FAILED" };
  const connection = await prisma.websiteConnection.findFirst({
    where: { credentialHash: hashSecret(match[1]) },
    include: { website: true },
  });
  if (!connection) return { ok: false, error: "CONNECTOR_AUTH_FAILED" };
  if (connection.status !== "ACTIVE") return { ok: false, error: "CONNECTOR_REVOKED" };
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false, error: "REQUEST_TIMESTAMP_INVALID" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > CONNECTOR_LIMITS.timestampWindowSeconds) {
    return { ok: false, error: "REQUEST_TIMESTAMP_INVALID" };
  }
  if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 128 || !/^[A-Za-z0-9_-]+$/.test(nonce)) {
    return { ok: false, error: "REQUEST_REPLAYED" };
  }
  // Opportunistic cleanup so the nonce table cannot grow unboundedly:
  // entries older than twice the timestamp window are useless.
  await prisma.connectorRequestNonce.deleteMany({
    where: {
      connectionId: connection.id,
      createdAt: { lt: new Date(Date.now() - 2 * CONNECTOR_LIMITS.timestampWindowSeconds * 1000) },
    },
  });
  try {
    await prisma.connectorRequestNonce.create({
      data: { connectionId: connection.id, nonce },
    });
  } catch (err) {
    if (err?.code === "P2002") return { ok: false, error: "REQUEST_REPLAYED" };
    throw err;
  }
  if (
    !diagnosticsLimiter.check(
      `diag:${connection.id}`,
      CONNECTOR_LIMITS.diagnosticsPerConnectionPerHour,
      CONNECTOR_LIMITS.diagnosticsWindowMs,
    )
  ) {
    return { ok: false, error: "RATE_LIMITED" };
  }
  return { ok: true, connection };
}

// --- Diagnostic snapshot storage ---

export async function storeSnapshot({ connection, payload }) {
  const validated = validateSnapshot(payload);
  if (!validated.ok) return { ok: false, error: "INVALID_DIAGNOSTIC_PAYLOAD" };
  const snapshot = validated.snapshot;
  if (!siteIdentityMatches(connection.website.normalizedUrl, snapshot.homeUrl, snapshot.siteUrl)) {
    return { ok: false, error: "SITE_IDENTITY_MISMATCH" };
  }
  // Bounded latest-snapshot model: replace, never accumulate history.
  const receivedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: connection.id } });
    await tx.connectorDiagnosticSnapshot.create({
      data: {
        connectionId: connection.id,
        websiteId: connection.websiteId,
        schemaVersion: snapshot.schemaVersion,
        payload: snapshot,
        receivedAt,
      },
    });
    await tx.websiteConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: receivedAt, lastSeenAt: receivedAt },
    });
  });
  return { ok: true, receivedAt };
}

// --- Revocation (session-authenticated; routes enforce ownership) ---

export async function revokeConnection({ userId, connectionId }) {
  const connection = await prisma.websiteConnection.findFirst({
    where: { id: connectionId, website: { userId } },
    include: { website: true },
  });
  if (!connection) return { ok: false, error: "NOT_FOUND" };
  await prisma.$transaction(async (tx) => {
    await tx.websiteConnection.update({
      where: { id: connection.id },
      data: { status: "REVOKED" },
    });
    await tx.website.update({
      where: { id: connection.websiteId },
      data: { connectionStatus: "NOT_CONNECTED" },
    });
  });
  return { ok: true, websiteId: connection.websiteId };
}

export function safeConnectorMessage(code) {
  return CONNECTOR_ERRORS[code] || CONNECTOR_ERRORS.DATABASE_OPERATION_FAILED;
}
