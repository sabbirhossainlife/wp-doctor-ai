import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser } from "../../../../lib/session";
import { elementorSummary, publicFinding } from "../../../../lib/elementor/service";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    // Ownership enforced in the query: another user's report does not match.
    const diagnostic = await prisma.elementorDiagnostic.findFirst({
      where: { id, userId: user.id },
      include: { findings: { orderBy: { createdAt: "asc" } } },
    });
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ diagnostic: elementorSummary(diagnostic, diagnostic.findings.map(publicFinding)) });
  } catch {
    return NextResponse.json({ error: "Could not load the Elementor diagnostic." }, { status: 500 });
  }
}
