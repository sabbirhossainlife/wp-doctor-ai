import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser } from "../../../lib/session";
import { validateWebsiteInput } from "../../../lib/websites";

function safeWebsite(w) {
  return {
    id: w.id,
    name: w.name,
    normalizedUrl: w.normalizedUrl,
    connectionStatus: w.connectionStatus,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const websites = await prisma.website.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ websites: websites.map(safeWebsite) });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // Mass-assignment guard: only name + url are read. Any client-supplied
  // role, userId, connectionStatus, or id is ignored entirely.
  const { errors, name, normalizedUrl } = validateWebsiteInput({
    name: body?.name,
    url: body?.url,
  });
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }
  try {
    const website = await prisma.website.create({
      data: {
        name,
        normalizedUrl,
        userId: user.id,
        connectionStatus: "NOT_CONNECTED",
      },
    });
    return NextResponse.json({ website: safeWebsite(website) }, { status: 201 });
  } catch (err) {
    if (err?.code === "P2002") {
      return NextResponse.json(
        { errors: { url: "You already registered this website." } },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Could not save this website. Try again." },
      { status: 500 }
    );
  }
}
