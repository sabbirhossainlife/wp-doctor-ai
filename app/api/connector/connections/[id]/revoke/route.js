import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../../lib/session";
import { revokeConnection } from "../../../../../../lib/connector/service";

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const id = (await params).id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }
  try {
    const result = await revokeConnection({ userId: user.id, connectionId: id });
    if (!result.ok) {
      // Identical 404 for nonexistent vs another user's connection.
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, websiteId: result.websiteId });
  } catch {
    return NextResponse.json({ error: "Could not revoke the connection. Try again." }, { status: 500 });
  }
}
