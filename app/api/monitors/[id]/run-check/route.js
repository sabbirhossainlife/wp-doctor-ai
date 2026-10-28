import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/session";
import { runManualCheck, UptimeError } from "../../../../../lib/uptime/service";

export const runtime = "nodejs";

export async function POST(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const result = await runManualCheck(user.id, (await params).id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UptimeError) {
      if (err.code === "MONITOR_NOT_FOUND" || err.code === "WEBSITE_NOT_FOUND") return NextResponse.json({ error: "Monitor not found." }, { status: 404 });
      if (err.code === "RATE_LIMITED") return NextResponse.json({ error: "Too many manual checks. Try again later." }, { status: 429 });
      if (err.code === "MONITOR_PAUSED") return NextResponse.json({ error: "This monitor is paused. Resume it before running a manual check." }, { status: 409 });
      if (err.code === "CHECK_IN_PROGRESS") return NextResponse.json({ error: "A check is already running for this monitor." }, { status: 409 });
      return NextResponse.json({ error: "Could not run the check." }, { status: err.status || 500 });
    }
    return NextResponse.json({ error: "Could not run the check." }, { status: 500 });
  }
}
