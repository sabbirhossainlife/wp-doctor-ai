import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser } from "../../../lib/session";
import {
  createElementorDiagnostic,
  elementorSummary,
  publicFinding,
  ElementorError,
} from "../../../lib/elementor/service";

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
      prisma.elementorDiagnostic.count({ where: { userId: user.id } }),
      prisma.elementorDiagnostic.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { findings: { orderBy: { createdAt: "asc" } } },
      }),
    ]);
    return NextResponse.json({
      diagnostics: diagnostics.map((d) => elementorSummary(d, d.findings.map(publicFinding))),
      total,
      page,
      pageSize,
    });
  } catch {
    return NextResponse.json({ error: "Could not load Elementor diagnostics." }, { status: 500 });
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
  // Mass-assignment guard: only websiteId, symptomCategory,
  // symptomDescription, affectedScope, affectedPages, deviceScope,
  // updatePreceded, startedAt, errorExcerpt are read. Any client-supplied
  // snapshot, inventory, connectorId, ownerId, status, or finding is ignored.
  try {
    const diagnostic = await createElementorDiagnostic(user.id, {
      websiteId: body?.websiteId,
      symptomCategory: body?.symptomCategory,
      symptomDescription: body?.symptomDescription,
      affectedScope: body?.affectedScope ?? null,
      affectedPages: body?.affectedPages ?? null,
      deviceScope: body?.deviceScope ?? null,
      updatePreceded: body?.updatePreceded ?? null,
      startedAt: body?.startedAt ?? null,
      errorExcerpt: body?.errorExcerpt ?? null,
    });
    return NextResponse.json({ diagnostic }, { status: 201 });
  } catch (err) {
    if (err instanceof ElementorError) {
      if (err.code === "NOT_FOUND") {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
      if (err.code === "RATE_LIMITED") {
        return NextResponse.json({ error: "Too many Elementor diagnostics. Please try again later." }, { status: 429 });
      }
      if (err.code === "VALIDATION_FAILED") {
        return NextResponse.json({ errors: err.payload.errors }, { status: 400 });
      }
      if (err.code.startsWith("SNAPSHOT_")) {
        // Blocked run: no diagnostic row was persisted. The caller must
        // re-sync from WordPress and retry; nothing is claimed as current.
        return NextResponse.json(
          {
            error: "The stored diagnostic snapshot is not usable for a current check.",
            snapshotStatus: err.payload.snapshotStatus,
            resyncInstructions: err.payload.resyncInstructions,
          },
          { status: 422 },
        );
      }
      return NextResponse.json({ error: "Could not complete the Elementor diagnostic. Try again." }, { status: err.status || 500 });
    }
    return NextResponse.json({ error: "Could not complete the Elementor diagnostic. Try again." }, { status: 500 });
  }
}
