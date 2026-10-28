import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser } from "../../../../lib/session";
import { speedSummary, publicFinding } from "../../../../lib/speed/service";
import { publicSpeedAnalysis } from "../../../../lib/speed/ai";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    // Ownership enforced in the query: another user's report does not match.
    const diagnostic = await prisma.speedDiagnostic.findFirst({
      where: { id, userId: user.id },
      include: {
        findings: { orderBy: { createdAt: "asc" } },
        aiAnalysis: true,
      },
    });
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({
      diagnostic: speedSummary(diagnostic, diagnostic.findings.map(publicFinding)),
      aiAnalysis: publicSpeedAnalysis(diagnostic.aiAnalysis),
    });
  } catch {
    return NextResponse.json({ error: "Could not load the speed diagnostic." }, { status: 500 });
  }
}
