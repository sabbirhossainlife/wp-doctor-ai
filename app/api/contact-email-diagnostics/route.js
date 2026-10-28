import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/session";
import {
  createContactEmailDiagnostic,
  listContactEmailDiagnostics,
  ContactEmailError,
} from "../../../lib/contact-email/service";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  let page = Number.parseInt(params.get("page") ?? "1", 10);
  let pageSize = Number.parseInt(params.get("pageSize") ?? "20", 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 20;
  if (pageSize > 100) pageSize = 100;
  try {
    const result = await listContactEmailDiagnostics(user.id, { page, pageSize });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Could not load contact/email diagnostics." }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let text;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // Mass-assignment guard: only websiteId, url, emailDomain and
  // dkimSelector are read. Any client-supplied finding, snapshot,
  // observation, status, or ownerId is ignored. When websiteId is
  // supplied, the server uses ONLY the owned Website record's stored URL
  // and latest snapshot; a client url alongside it is ignored.
  try {
    const diagnostic = await createContactEmailDiagnostic(user.id, {
      url: body?.url,
      websiteId: body?.websiteId,
      emailDomain: body?.emailDomain,
      dkimSelector: body?.dkimSelector,
    });
    return NextResponse.json({ diagnostic }, { status: 201 });
  } catch (err) {
    if (err instanceof ContactEmailError) {
      if (err.code === "RATE_LIMITED") return NextResponse.json({ error: "Too many contact/email checks. Try again later." }, { status: 429 });
      if (err.code === "VALIDATION_FAILED") return NextResponse.json({ error: "Invalid input.", errors: err.payload.errors ?? {} }, { status: 400 });
      if (err.code === "WEBSITE_NOT_FOUND") return NextResponse.json({ error: "Website not found." }, { status: 404 });
      if (["SNAPSHOT_MISSING", "SNAPSHOT_INVALID", "SNAPSHOT_UNSUPPORTED", "SNAPSHOT_STALE"].includes(err.code)) {
        return NextResponse.json({ error: "No fresh diagnostic snapshot is available for this website.", snapshotStatus: err.code, resyncInstructions: err.payload.resyncInstructions ?? null }, { status: 422 });
      }
      return NextResponse.json({ error: "Could not run the contact/email check." }, { status: err.status || 500 });
    }
    return NextResponse.json({ error: "Could not run the contact/email check." }, { status: 500 });
  }
}
