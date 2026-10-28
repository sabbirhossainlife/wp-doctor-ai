import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { getSchedulerHealth } from "../../../../lib/uptime/service";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const health = await getSchedulerHealth();
    return NextResponse.json(health);
  } catch {
    return NextResponse.json({ error: "Could not load monitoring health." }, { status: 500 });
  }
}
