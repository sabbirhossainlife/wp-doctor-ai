import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/session";
import { createBackupJob, listBackupJobs } from "../../../lib/backup/service";
import { backupErrorResponse, readJson } from "../../../lib/backup/http";
export const runtime = "nodejs";
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try { return NextResponse.json(await listBackupJobs(user.id, { page: Number.parseInt(params.get("page") ?? "1", 10) || 1, pageSize: Number.parseInt(params.get("pageSize") ?? "20", 10) || 20 })); }
  catch (err) { return backupErrorResponse(err); }
}
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await readJson(request);
    const result = await createBackupJob(user.id, { websiteId: body?.websiteId, mode: body?.mode, acknowledgeSensitiveData: body?.acknowledgeSensitiveData });
    return NextResponse.json(result, { status: result.blocked ? 422 : 201 });
  } catch (err) { return backupErrorResponse(err); }
}
