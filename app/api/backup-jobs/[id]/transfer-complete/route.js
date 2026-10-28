import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/session";
import { transferComplete } from "../../../../../lib/backup/service";
import { backupErrorResponse, readJson } from "../../../../../lib/backup/http";
export const runtime = "nodejs";
export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await readJson(request, 10240);
    const result = await transferComplete(user.id, (await params).id, body);
    return NextResponse.json(result);
  } catch (err) { return backupErrorResponse(err); }
}
