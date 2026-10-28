import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser } from "../../../../lib/session";
import { scanSummary } from "../../../../lib/scans";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  if (typeof id !== "string" || id.length === 0 || id.length > 100) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }
  try {
    // Ownership is enforced in the query itself: another user's record (or
    // a nonexistent id) simply does not match, and both return 404.
    const scan = await prisma.scan.findFirst({
      where: { id, userId: user.id },
      include: { findings: { orderBy: { createdAt: "asc" } } },
    });
    if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    return NextResponse.json({ scan: scanSummary(scan, scan.findings) });
  } catch {
    return NextResponse.json({ error: "Could not load this scan." }, { status: 500 });
  }
}
