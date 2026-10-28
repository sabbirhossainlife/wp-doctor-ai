import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { getContactEmailDiagnostic, contactEmailSummary, publicFinding } from "../../../../lib/contact-email/service";
import { publicContactEmailAnalysis } from "../../../../lib/contact-email/ai";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    // Ownership enforced in the query: another user's report does not match.
    const diagnostic = await getContactEmailDiagnostic(user.id, id);
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({
      diagnostic: contactEmailSummary(diagnostic, diagnostic.findings.map(publicFinding)),
      aiAnalysis: publicContactEmailAnalysis(diagnostic.aiAnalysis),
    });
  } catch {
    return NextResponse.json({ error: "Could not load the contact/email diagnostic." }, { status: 500 });
  }
}
