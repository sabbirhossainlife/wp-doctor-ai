import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { getCurrentUser } from "../../../../../lib/session";
import {
  generateConflictAiAnalysis,
  publicConflictAnalysis,
} from "../../../../../lib/conflict/ai";
import { AiProviderError } from "../../../../../lib/ai/providers";
import { ConflictAiValidationError } from "../../../../../lib/conflict/ai-validate";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

async function loadOwnedDiagnostic(userId, id) {
  return prisma.conflictDiagnostic.findFirst({
    where: { id, userId },
    include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
  });
}

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  try {
    const diagnostic = await loadOwnedDiagnostic(user.id, id);
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ analysis: publicConflictAnalysis(diagnostic.aiAnalysis) });
  } catch {
    return NextResponse.json({ error: "Could not load the AI analysis." }, { status: 500 });
  }
}

// Explicit user trigger only. No mock provider is ever used here: when AI
// is unconfigured the route returns 503 AI_NOT_CONFIGURED and the
// deterministic report stands on its own.
export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let text;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  const { id } = await params;
  try {
    const diagnostic = await loadOwnedDiagnostic(user.id, id);
    if (!diagnostic) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const result = await generateConflictAiAnalysis({
      diagnostic,
      findings: diagnostic.findings,
      userId: user.id,
    });
    return NextResponse.json({ analysis: result }, { status: 201 });
  } catch (err) {
    if (err instanceof AiProviderError && err.code === "AI_NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "AI interpretation is not configured.", code: "AI_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    if (err instanceof AiProviderError && err.code === "ALREADY_RUNNING") {
      return NextResponse.json({ error: "An AI analysis is already running for this diagnostic." }, { status: 409 });
    }
    if (err instanceof AiProviderError && err.code === "RATE_LIMITED") {
      return NextResponse.json({ error: "Too many AI explanations requested. Try again tomorrow." }, { status: 429 });
    }
    if (err instanceof ConflictAiValidationError || (err instanceof AiProviderError)) {
      return NextResponse.json({ error: "The AI provider could not produce a valid interpretation. Try again." }, { status: 502 });
    }
    return NextResponse.json({ error: "Could not generate the AI interpretation. Try again." }, { status: 500 });
  }
}
