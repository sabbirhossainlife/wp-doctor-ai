import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/session";
import { listIncidents, UptimeError } from "../../../../../lib/uptime/service";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const search = new URL(request.url).searchParams;
  let page = Number.parseInt(search.get("page") ?? "1", 10);
  let pageSize = Number.parseInt(search.get("pageSize") ?? "20", 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 20;
  if (pageSize > 100) pageSize = 100;
  try {
    const result = await listIncidents(user.id, (await params).id, { page, pageSize });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UptimeError && err.code === "MONITOR_NOT_FOUND") return NextResponse.json({ error: "Monitor not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not load incidents." }, { status: 500 });
  }
}
