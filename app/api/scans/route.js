import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser } from "../../../lib/session";
import { createScan, scanSummary } from "../../../lib/scans";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 10 * 1024;

function summaryOnly(scan) {
  const { findings, ...rest } = scanSummary(scan);
  return rest;
}

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
    const [total, scans] = await Promise.all([
      prisma.scan.count({ where: { userId: user.id } }),
      prisma.scan.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return NextResponse.json({
      scans: scans.map(summaryOnly),
      total,
      page,
      pageSize,
    });
  } catch {
    return NextResponse.json({ error: "Could not load scan history." }, { status: 500 });
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
  // Mass-assignment guard: only `url` is read. Any client-supplied userId,
  // scan id, status, or outcome is ignored entirely.
  const url = body?.url;
  if (typeof url !== "string" || url.trim().length === 0) {
    return NextResponse.json({ errors: { url: "Enter a website URL to scan." } }, { status: 400 });
  }
  try {
    const { scan, rateLimited } = await createScan(user, url);
    if (rateLimited) {
      return NextResponse.json(
        { scan, error: "Too many scan requests. Please try again later." },
        { status: 429 },
      );
    }
    return NextResponse.json({ scan }, { status: 201 });
  } catch {
    // Includes persistence failures: never claim a report was saved when it
    // was not. Scanner outcomes themselves are persisted by the service and
    // returned above, so reaching here means the save (or scan plumbing)
    // failed, not that the website is broken.
    return NextResponse.json({ error: "Could not complete the scan. Try again." }, { status: 500 });
  }
}
