import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { acknowledgeNotification, UptimeError } from "../../../../lib/uptime/service";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

export async function PATCH(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let text;
  try { text = await request.text(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  try {
    const notification = await acknowledgeNotification(user.id, (await params).id, body?.action === "DISMISSED" ? "DISMISSED" : "READ");
    return NextResponse.json({ notification });
  } catch {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }
}
