import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { getSslRedirectDiagnostic, sslSummary, publicFinding } from "../../../../lib/ssl/service";
import { publicSslAnalysis } from "../../../../lib/ssl/ai";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    // Ownership enforced in the query: another user's report does not match.
    const diagnostic = await getSslRedirectDiagnostic(user.id, id);
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({
      diagnostic: sslSummary(diagnostic, diagnostic.findings.map(publicFinding)),
      aiAnalysis: publicSslAnalysis(diagnostic.aiAnalysis),
    });
  } catch {
    return NextResponse.json({ error: "Could not load the SSL diagnostic." }, { status: 500 });
  }
}
