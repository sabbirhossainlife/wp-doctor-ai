import { NextResponse } from "next/server";
import { verifyConnectorRequest, safeConnectorMessage } from "../../../../../../lib/connector/service";
import { transferCompleteForConnection } from "../../../../../../lib/backup/service";
import { backupErrorResponse, readJson } from "../../../../../../lib/backup/http";
export const runtime = "nodejs";
// Connector-authenticated (Bearer + timestamp + nonce), never session
// auth, never client-supplied user/website ids: the job resolves through
// the connection's own website.
export async function POST(request, { params }) {
  try {
    const body = await readJson(request, 10240);
    const auth = await verifyConnectorRequest({ authorization: request.headers.get("authorization"), timestamp: request.headers.get("x-wpdoctor-timestamp"), nonce: request.headers.get("x-wpdoctor-nonce") });
    if (!auth.ok) return NextResponse.json({ error: safeConnectorMessage(auth.error), code: auth.error }, { status: auth.error === "CONNECTOR_AUTH_FAILED" ? 401 : auth.error === "CONNECTOR_REVOKED" ? 403 : auth.error === "REQUEST_REPLAYED" ? 409 : 400 });
    const result = await transferCompleteForConnection(auth.connection, (await params).jobId, body);
    return NextResponse.json(result);
  } catch (err) { return backupErrorResponse(err); }
}
