import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/session";
import { createWindow, listWindows, UptimeError } from "../../../lib/uptime/service";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const monitorId = new URL(request.url).searchParams.get("monitorId");
  try {
    const result = await listWindows(user.id, monitorId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UptimeError) return NextResponse.json({ error: "Monitor not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not load maintenance windows." }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let text;
  try { text = await request.text(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  try {
    const window = await createWindow(user.id, {
      monitorId: body?.monitorId,
      title: body?.title,
      description: body?.description,
      startAt: body?.startAt,
      endAt: body?.endAt,
      timezone: body?.timezone,
      suppressAlerts: body?.suppressAlerts,
      pauseChecks: body?.pauseChecks,
      recurrence: body?.recurrence,
    });
    return NextResponse.json({ window }, { status: 201 });
  } catch (err) {
    if (err instanceof UptimeError) {
      if (err.code === "MONITOR_NOT_FOUND") return NextResponse.json({ error: "Monitor not found." }, { status: 404 });
      if (err.code === "VALIDATION_FAILED") return NextResponse.json({ error: "Invalid input.", errors: err.payload.errors ?? {} }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not create the maintenance window." }, { status: 500 });
  }
}
