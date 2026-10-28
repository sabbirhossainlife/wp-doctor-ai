import { NextResponse } from "next/server";
import { runTick } from "../../../../../lib/uptime/service";
import { tickSecretConfigured, validateTickSecret } from "../../../../../lib/uptime/scheduler";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

// Server-only scheduler trigger. Ordinary browser clients and
// authenticated users cannot invoke this: only the secret holder can,
// and the work per invocation is bounded (max 10 checks).
export async function POST(request) {
  if (!tickSecretConfigured()) {
    return NextResponse.json({ error: "Scheduler not configured.", code: "SCHEDULER_NOT_CONFIGURED" }, { status: 503 });
  }
  const provided = request.headers.get("x-monitoring-tick-secret");
  if (!validateTickSecret(provided)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let text;
  try { text = await request.text(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const batchLimit = Number.isInteger(body?.batchLimit) && body.batchLimit >= 1 && body.batchLimit <= 10 ? body.batchLimit : 10;
  try {
    const summary = await runTick({ batchLimit });
    // Bounded aggregate status only: no monitor URLs, no secrets.
    return NextResponse.json({ tick: summary });
  } catch {
    return NextResponse.json({ error: "Scheduler tick failed." }, { status: 500 });
  }
}
