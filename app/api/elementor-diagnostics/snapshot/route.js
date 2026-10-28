import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { getElementorSnapshotView, ElementorError } from "../../../../lib/elementor/service";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const websiteId = new URL(request.url).searchParams.get("websiteId");
  if (typeof websiteId !== "string" || websiteId.length === 0) {
    return NextResponse.json({ error: "A websiteId is required." }, { status: 400 });
  }
  try {
    const view = await getElementorSnapshotView(user.id, websiteId);
    return NextResponse.json(view);
  } catch (err) {
    if (err instanceof ElementorError && err.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not load the snapshot." }, { status: 500 });
  }
}
