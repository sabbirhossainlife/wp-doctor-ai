import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/session";
import { deleteArtifact } from "../../../../../lib/backup/service";
import { backupErrorResponse, readJson } from "../../../../../lib/backup/http";
export const runtime = "nodejs";
export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await readJson(request);
    const id = (await params).id;
    // Deletion requires the caller to name the exact artifact id: a bare
    // POST with no matching id never deletes anything.
    if (body?.artifactId !== id || body?.confirm !== true) return NextResponse.json({ error: "Deletion requires explicit confirmation with the artifact id." }, { status: 400 });
    return NextResponse.json({ artifact: await deleteArtifact(user.id, id) });
  } catch (err) { return backupErrorResponse(err); }
}
