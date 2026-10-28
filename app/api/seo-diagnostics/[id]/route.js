import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { getSeoDiagnostic, seoSummary, publicFinding } from "../../../../lib/seo/service";
import { publicSeoAnalysis } from "../../../../lib/seo/ai";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    // Ownership enforced in the query: another user's report does not match.
    const diagnostic = await getSeoDiagnostic(user.id, id);
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({
      diagnostic: seoSummary(diagnostic, diagnostic.findings.map(publicFinding), diagnostic.aiAnalysis),
      aiAnalysis: publicSeoAnalysis(diagnostic.aiAnalysis),
    });
  } catch {
    return NextResponse.json({ error: "Could not load the SEO diagnostic." }, { status: 500 });
  }
}
