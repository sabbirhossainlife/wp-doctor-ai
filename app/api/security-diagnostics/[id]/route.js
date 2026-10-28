import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { getSecurityDiagnostic, securitySummary, publicFinding } from "../../../../lib/security/service";
import { publicSecurityAnalysis } from "../../../../lib/security/ai";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    // Ownership enforced in the query: another user's report does not match.
    const diagnostic = await getSecurityDiagnostic(user.id, id);
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({
      diagnostic: securitySummary(diagnostic, diagnostic.findings.map(publicFinding)),
      aiAnalysis: publicSecurityAnalysis(diagnostic.aiAnalysis),
    });
  } catch {
    return NextResponse.json({ error: "Could not load the security diagnostic." }, { status: 500 });
  }
}
