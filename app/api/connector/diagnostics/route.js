import { NextResponse } from "next/server";
import {
  verifyConnectorRequest,
  storeSnapshot,
  safeConnectorMessage,
} from "../../../../lib/connector/service";
import { CONNECTOR_LIMITS } from "../../../../lib/connector/rate-limit";

// Connector-authenticated endpoint (Bearer credential + timestamp +
// nonce). No session cookie is accepted here, and no plugin-supplied
// userId/websiteId is trusted — everything derives from the credential.
const STATUS_BY_ERROR = {
  CONNECTOR_AUTH_FAILED: 401,
  CONNECTOR_REVOKED: 403,
  REQUEST_TIMESTAMP_INVALID: 400,
  REQUEST_REPLAYED: 409,
  INVALID_DIAGNOSTIC_PAYLOAD: 400,
  SITE_IDENTITY_MISMATCH: 400,
  REQUEST_TOO_LARGE: 413,
  RATE_LIMITED: 429,
};

export async function POST(request) {
  let text;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (text.length > CONNECTOR_LIMITS.maxDiagnosticsBodyBytes) {
    return NextResponse.json(
      { error: safeConnectorMessage("REQUEST_TOO_LARGE"), code: "REQUEST_TOO_LARGE" },
      { status: 413 },
    );
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: safeConnectorMessage("INVALID_DIAGNOSTIC_PAYLOAD"), code: "INVALID_DIAGNOSTIC_PAYLOAD" },
      { status: 400 },
    );
  }
  try {
    const auth = await verifyConnectorRequest({
      authorization: request.headers.get("authorization"),
      timestamp: request.headers.get("x-wpdoctor-timestamp"),
      nonce: request.headers.get("x-wpdoctor-nonce"),
    });
    if (!auth.ok) {
      return NextResponse.json(
        { error: safeConnectorMessage(auth.error), code: auth.error },
        { status: STATUS_BY_ERROR[auth.error] || 500 },
      );
    }
    const stored = await storeSnapshot({ connection: auth.connection, payload });
    if (!stored.ok) {
      return NextResponse.json(
        { error: safeConnectorMessage(stored.error), code: stored.error },
        { status: STATUS_BY_ERROR[stored.error] || 500 },
      );
    }
    return NextResponse.json({ ok: true, receivedAt: stored.receivedAt });
  } catch {
    return NextResponse.json(
      { error: safeConnectorMessage("DATABASE_OPERATION_FAILED"), code: "DATABASE_OPERATION_FAILED" },
      { status: 500 },
    );
  }
}
