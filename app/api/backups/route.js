import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/session";
import { listArtifacts } from "../../../lib/backup/service";
import { backupErrorResponse } from "../../../lib/backup/http";
export const runtime = "nodejs";
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try { return NextResponse.json(await listArtifacts(user.id, { page: Number.parseInt(params.get("page") ?? "1", 10) || 1, pageSize: Number.parseInt(params.get("pageSize") ?? "20", 10) || 20 })); }
  catch (err) { return backupErrorResponse(err); }
}
