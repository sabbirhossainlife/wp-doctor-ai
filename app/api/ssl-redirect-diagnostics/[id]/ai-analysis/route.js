import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/session";
import { getSslRedirectDiagnostic } from "../../../../../lib/ssl/service";
import { generateSslAiAnalysis, publicSslAnalysis } from "../../../../../lib/ssl/ai";
import { AiProviderError } from "../../../../../lib/ai/providers";
import { SslAiValidationError } from "../../../../../lib/ssl/ai-validate";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    const diagnostic = await getSslRedirectDiagnostic(user.id, id);
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ aiAnalysis: publicSslAnalysis(diagnostic.aiAnalysis) });
  } catch {
    return NextResponse.json({ error: "Could not load the AI analysis." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  let text = "";
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  try {
    const diagnostic = await getSslRedirectDiagnostic(user.id, id);
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const result = await generateSslAiAnalysis({
      diagnostic,
      findings: diagnostic.findings,
      userId: user.id,
      regenerate: body?.regenerate === true,
    });
    return NextResponse.json({ aiAnalysis: result }, { status: 201 });
  } catch (err) {
    if (err instanceof AiProviderError) {
      if (err.code === "AI_NOT_CONFIGURED") return NextResponse.json({ error: "AI explanations are not configured.", code: "AI_NOT_CONFIGURED" }, { status: 503 });
      if (err.code === "RATE_LIMITED") return NextResponse.json({ error: "Too many AI explanations requested. Try again tomorrow." }, { status: 429 });
      if (err.code === "ALREADY_RUNNING") return NextResponse.json({ error: "An AI analysis is already running for this report." }, { status: 409 });
      return NextResponse.json({ error: "The AI explanation could not be generated.", code: err.code }, { status: 502 });
    }
    if (err instanceof SslAiValidationError) {
      return NextResponse.json({ error: "The AI output failed validation and was discarded.", code: "INVALID_OUTPUT" }, { status: 502 });
    }
    return NextResponse.json({ error: "The AI explanation could not be generated." }, { status: 500 });
  }
}
