import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/session";
import { createRestoreJob, listBackupJobs } from "../../../lib/backup/service";
import { backupErrorResponse, readJson } from "../../../lib/backup/http";
export const runtime = "nodejs";
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    const all = await listBackupJobs(user.id, { page: 1, pageSize: 100 });
    const type = "restore" === "restore" ? "RESTORE" : "MIGRATION";
    return NextResponse.json({ operations: all.operations.filter((o) => o.type === type), total: all.operations.filter((o) => o.type === type).length });
  } catch (err) { return backupErrorResponse(err); }
}
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await readJson(request);
    const result = await createRestoreJob(user.id, body);
    return NextResponse.json(result, { status: result.blocked ? 422 : 201 });
  } catch (err) { return backupErrorResponse(err); }
}
