import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/session";
import { consumeDownloadToken } from "../../../../../lib/backup/service";
import { backupErrorResponse } from "../../../../../lib/backup/http";
export const runtime = "nodejs";
// Streamed download: session authentication + ownership + a one-use,
// 5-minute download token. No permanent public URL is ever issued and
// no storage path or credential is exposed.
export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const token = new URL(request.url).searchParams.get("token") ?? "";
  try {
    const { buffer, artifact } = await consumeDownloadToken(user.id, (await params).id, token);
    return new NextResponse(buffer, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="wp-doctor-ai-backup-${artifact.id}.zip"`, "Cache-Control": "no-store" } });
  } catch (err) { return backupErrorResponse(err); }
}
