import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser } from "../../../lib/session";
import {
  createSpeedDiagnostic,
  speedSummary,
  publicFinding,
  SpeedError,
} from "../../../lib/speed/service";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  let page = Number.parseInt(params.get("page") ?? "1", 10);
  let pageSize = Number.parseInt(params.get("pageSize") ?? "20", 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 20;
  if (pageSize > 100) pageSize = 100;
  try {
    const [total, diagnostics] = await Promise.all([
      prisma.speedDiagnostic.count({ where: { userId: user.id } }),
      prisma.speedDiagnostic.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { findings: { orderBy: { createdAt: "asc" } } },
      }),
    ]);
    return NextResponse.json({
      diagnostics: diagnostics.map((d) => speedSummary(d, d.findings.map(publicFinding))),
      total,
      page,
      pageSize,
    });
  } catch {
    return NextResponse.json({ error: "Could not load speed diagnostics." }, { status: 500 });
  }
}

export async function POST(request) {
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
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // Mass-assignment guard: only url + strategy are read. Any client-supplied
  // score, metric, provider response, status, finding, ownerId, or API key
  // is ignored. Consent is a UI gate; the server never trusts it as proof
  // of anything beyond this request, and the target is re-validated by the
  // scanner before any provider call.
  try {
    const diagnostic = await createSpeedDiagnostic(user.id, {
      url: body?.url,
      strategy: body?.strategy ?? "MOBILE",
    });
    return NextResponse.json({ diagnostic }, { status: 201 });
  } catch (err) {
    if (err instanceof SpeedError) {
      if (err.code === "RATE_LIMITED") return NextResponse.json({ error: "Too many speed checks. Try again later." }, { status: 429 });
      if (err.code === "VALIDATION_FAILED") return NextResponse.json({ error: "Invalid input.", errors: err.payload.errors ?? {} }, { status: 400 });
      return NextResponse.json({ error: "Could not run the speed check." }, { status: err.status || 500 });
    }
    return NextResponse.json({ error: "Could not run the speed check." }, { status: 500 });
  }
}
