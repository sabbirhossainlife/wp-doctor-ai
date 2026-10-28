import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../../lib/session";
import { acknowledgeIncident, UptimeError } from "../../../../../../lib/uptime/service";

export const runtime = "nodejs";

export async function PATCH(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const p = await params;
  try {
    const incident = await acknowledgeIncident(user.id, p.id, p.incidentId);
    return NextResponse.json({ incident });
  } catch (err) {
    if (err instanceof UptimeError) return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not acknowledge the incident." }, { status: 500 });
  }
}
