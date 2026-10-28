import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser } from "../../../../lib/session";
import { wooSummary, publicFinding } from "../../../../lib/woocommerce/service";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    const diagnostic = await prisma.wooCommerceDiagnostic.findFirst({
      where: { id, userId: user.id },
      include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
    });
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const { aiAnalysis, ...rest } = diagnostic;
    return NextResponse.json({
      diagnostic: wooSummary(rest, diagnostic.findings.map(publicFinding)),
      aiAnalysis: aiAnalysis
        ? {
            status: aiAnalysis.status,
            provider: aiAnalysis.provider,
            model: aiAnalysis.model,
            schemaVersion: aiAnalysis.schemaVersion,
            analysis: aiAnalysis.analysis,
            errorCode: aiAnalysis.errorCode,
            completedAt: aiAnalysis.completedAt ? aiAnalysis.completedAt.toISOString() : null,
          }
        : null,
    });
  } catch {
    return NextResponse.json({ error: "Could not load the WooCommerce diagnostic." }, { status: 500 });
  }
}
