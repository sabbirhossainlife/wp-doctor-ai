import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";
import { getSchedulerHealth } from "../../../lib/uptime/service";
import { tickSecretConfigured } from "../../../lib/uptime/scheduler";
import { buildReadiness } from "../../../lib/readiness";

export const runtime = "nodejs";

// Authenticated readiness report (Phase G). Public /api/health stays
// minimal on purpose; detailed readiness requires a logged-in user and
// reveals no secrets, connection strings, storage paths, or key material.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  let schedulerLastTickAt = null;
  try {
    const health = await getSchedulerHealth();
    schedulerLastTickAt = health?.lastTickAt ?? null;
  } catch {
    schedulerLastTickAt = null;
  }
  return NextResponse.json(
    buildReadiness({
      dbOk,
      schedulerSecretConfigured: tickSecretConfigured(),
      schedulerLastTickAt,
    }),
  );
}
