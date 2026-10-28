import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { getCurrentUser } from "../../../../../lib/session";
import {
  generateAiAnalysis,
  getAiConfig,
  isAiConfigured,
  publicAnalysis,
} from "../../../../../lib/ai/analyze";
import { AiProviderError } from "../../../../../lib/ai/providers";
import { AiValidationError } from "../../../../../lib/ai/validate";

export const runtime = "nodejs";

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "BLOCKED"]);

function statusForCode(code) {
  switch (code) {
    case "AI_NOT_CONFIGURED": return 503;
    case "RATE_LIMITED": return 429;
    case "PROVIDER_RATE_LIMITED": return 429;
    case "ALREADY_RUNNING": return 409;
    case "PROVIDER_TIMEOUT":
    case "PROVIDER_ERROR":
    case "PROVIDER_REFUSAL":
    case "INVALID_OUTPUT": return 502;
    default: return 500;
  }
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  if (typeof id !== "string" || id.length === 0 || id.length > 100) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }
  let body = {};
  try {
    const text = await request.text();
    if (text.length > 10 * 1024) return NextResponse.json({ error: "Request body too large." }, { status: 413 });
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // Only `regenerate` is read. Any client-supplied outcome, evidence,
  // finding IDs, or owner fields are ignored: the server loads everything
  // from the database.
  const regenerate = body?.regenerate === true;

  try {
    const scan = await prisma.scan.findFirst({
      where: { id, userId: user.id },
      include: { findings: { orderBy: { createdAt: "asc" } } },
    });
    if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    if (!TERMINAL_STATES.has(scan.executionStatus)) {
      return NextResponse.json({ error: "This scan is not ready for AI analysis yet.", code: "SCAN_NOT_TERMINAL" }, { status: 409 });
    }
    const config = getAiConfig();
    if (!isAiConfigured(config)) {
      return NextResponse.json({ error: "AI explanations are not configured.", code: "AI_NOT_CONFIGURED" }, { status: 503 });
    }
    const result = await generateAiAnalysis({
      prisma,
      scan,
      findings: scan.findings,
      userId: user.id,
      regenerate,
      config,
    });
    return NextResponse.json({ analysis: result }, { status: 200 });
  } catch (err) {
    if (err instanceof AiProviderError || err instanceof AiValidationError) {
      const code = err instanceof AiValidationError ? "INVALID_OUTPUT" : err.code;
      return NextResponse.json({ error: "Could not generate the AI explanation.", code }, { status: statusForCode(code) });
    }
    return NextResponse.json({ error: "Could not generate the AI explanation." }, { status: 500 });
  }
}

// Read the saved analysis for this scan (same ownership rules as the report).
export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  if (typeof id !== "string" || id.length === 0 || id.length > 100) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }
  try {
    const scan = await prisma.scan.findFirst({ where: { id, userId: user.id } });
    if (!scan) return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    const row = await prisma.aiAnalysis.findUnique({ where: { scanId: scan.id } });
    if (!row) return NextResponse.json({ analysis: null }, { status: 200 });
    return NextResponse.json({ analysis: publicAnalysis(row) }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Could not load the AI explanation." }, { status: 500 });
  }
}
