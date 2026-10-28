import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { getBackupOperation } from "../../../../lib/backup/service";
import { backupErrorResponse } from "../../../../lib/backup/http";
export const runtime = "nodejs";
export async function GET(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try { return NextResponse.json({ operation: await getBackupOperation(user.id, (await params).id) }); }
  catch (err) { return backupErrorResponse(err); }
}
