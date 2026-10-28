import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { getMonitorDetail, updateMonitor, deleteMonitor, UptimeError } from "../../../../lib/uptime/service";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

function mapError(err) {
  if (err instanceof UptimeError) {
    if (err.code === "MONITOR_NOT_FOUND" || err.code === "WEBSITE_NOT_FOUND") return NextResponse.json({ error: "Monitor not found." }, { status: 404 });
    if (err.code === "VALIDATION_FAILED") return NextResponse.json({ error: "Invalid input.", errors: err.payload.errors ?? {} }, { status: 400 });
    return NextResponse.json({ error: "Could not complete the request." }, { status: err.status || 500 });
  }
  return NextResponse.json({ error: "Could not complete the request." }, { status: 500 });
}

export async function GET(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const detail = await getMonitorDetail(user.id, (await params).id);
    return NextResponse.json(detail);
  } catch (err) { return mapError(err); }
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
    const monitor = await updateMonitor(user.id, (await params).id, {
      paused: body?.paused,
      checkIntervalMinutes: body?.checkIntervalMinutes,
      warningLatencyMs: body?.warningLatencyMs,
      highLatencyMs: body?.highLatencyMs,
      failureThreshold: body?.failureThreshold,
      recoveryThreshold: body?.recoveryThreshold,
      maintenanceDetectionEnabled: body?.maintenanceDetectionEnabled,
      notifyInApp: body?.notifyInApp,
      notifyEmail: body?.notifyEmail,
      confirmTarget: body?.confirmTarget,
    });
    return NextResponse.json({ monitor });
  } catch (err) { return mapError(err); }
}

export async function DELETE(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const result = await deleteMonitor(user.id, (await params).id);
    return NextResponse.json(result);
  } catch (err) { return mapError(err); }
}
