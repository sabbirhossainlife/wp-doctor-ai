import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { getWindow, cancelWindow, deleteWindow, UptimeError } from "../../../../lib/uptime/service";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

export async function GET(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const window = await getWindow(user.id, (await params).id);
    return NextResponse.json({ window });
  } catch {
    return NextResponse.json({ error: "Maintenance window not found." }, { status: 404 });
  }
}

export async function PATCH(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let text;
  try { text = await request.text(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  try {
    if (body?.status !== "CANCELLED") return NextResponse.json({ error: "Only cancellation is supported for a maintenance window." }, { status: 400 });
    const window = await cancelWindow(user.id, (await params).id);
    return NextResponse.json({ window });
  } catch {
    return NextResponse.json({ error: "Maintenance window not found." }, { status: 404 });
  }
}

export async function DELETE(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const result = await deleteWindow(user.id, (await params).id);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Maintenance window not found." }, { status: 404 });
  }
}
