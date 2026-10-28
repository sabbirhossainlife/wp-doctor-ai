import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/session";
import { createMonitor, listMonitors, UptimeError } from "../../../lib/uptime/service";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

function mapError(err) {
  if (err instanceof UptimeError) {
    if (err.code === "WEBSITE_NOT_FOUND" || err.code === "MONITOR_NOT_FOUND") return NextResponse.json({ error: "Monitor not found." }, { status: 404 });
    if (err.code === "VALIDATION_FAILED") return NextResponse.json({ error: "Invalid input.", errors: err.payload.errors ?? {} }, { status: 400 });
    if (err.code === "MONITOR_LIMIT_REACHED") return NextResponse.json({ error: "Monitor limit reached (20 per account)." }, { status: 429 });
    return NextResponse.json({ error: "Could not complete the request." }, { status: err.status || 500 });
  }
  return NextResponse.json({ error: "Could not complete the request." }, { status: 500 });
}

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
    const result = await listMonitors(user.id, { page, pageSize });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Could not load monitors." }, { status: 500 });
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
    // Mass-assignment guard: only the documented config fields are read.
    // No target URL, status, latency, or incident state is accepted from
    // the client — the target comes only from the owned Website record.
    const monitor = await createMonitor(user.id, {
      websiteId: body?.websiteId,
      checkIntervalMinutes: body?.checkIntervalMinutes,
      warningLatencyMs: body?.warningLatencyMs,
      highLatencyMs: body?.highLatencyMs,
      failureThreshold: body?.failureThreshold,
      recoveryThreshold: body?.recoveryThreshold,
      maintenanceDetectionEnabled: body?.maintenanceDetectionEnabled,
      notifyInApp: body?.notifyInApp,
      notifyEmail: body?.notifyEmail,
    });
    return NextResponse.json({ monitor }, { status: 201 });
  } catch (err) { return mapError(err); }
}
