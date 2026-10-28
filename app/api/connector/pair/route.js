import { NextResponse } from "next/server";
import { consumePairing, safeConnectorMessage } from "../../../../lib/connector/service";
import { CONNECTOR_LIMITS } from "../../../../lib/connector/rate-limit";

// Code-gated endpoint (no session): the one-time pairing code IS the
// credential. The SaaS never fetches or scans the supplied URLs —
// identity is compared from strings only, so this is not an SSRF path.
const STATUS_BY_ERROR = {
  PAIRING_CODE_INVALID: 400,
  PAIRING_CODE_EXPIRED: 400,
  PAIRING_CODE_ALREADY_USED: 409,
  SITE_IDENTITY_MISMATCH: 400,
  RATE_LIMITED: 429,
};

export async function POST(request) {
  let body;
  try {
    const text = await request.text();
    if (text.length > CONNECTOR_LIMITS.maxDiagnosticsBodyBytes) {
      return NextResponse.json({ error: safeConnectorMessage("REQUEST_TOO_LARGE") }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // Only the documented fields are read; anything else is ignored.
  const input = {
    code: typeof body?.code === "string" ? body.code : null,
    homeUrl: typeof body?.homeUrl === "string" ? body.homeUrl : null,
    siteUrl: typeof body?.siteUrl === "string" ? body.siteUrl : null,
    pluginVersion: typeof body?.pluginVersion === "string" ? body.pluginVersion : null,
  };
  if (!input.code || !input.homeUrl || !input.siteUrl) {
    return NextResponse.json({ error: safeConnectorMessage("PAIRING_CODE_INVALID") }, { status: 400 });
  }
  try {
    const result = await consumePairing(input);
    if (!result.ok) {
      return NextResponse.json(
        { error: safeConnectorMessage(result.error), code: result.error },
        { status: STATUS_BY_ERROR[result.error] || 500 },
      );
    }
    // Raw credential returned ONCE. Never stored, logged, or shown again.
    return NextResponse.json({
      credential: result.credential,
      websiteId: result.websiteId,
      connectionId: result.connectionId,
      pairedAt: result.pairedAt,
    });
  } catch {
    return NextResponse.json(
      { error: safeConnectorMessage("DATABASE_OPERATION_FAILED"), code: "DATABASE_OPERATION_FAILED" },
      { status: 500 },
    );
  }
}
