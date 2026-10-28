import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser } from "../../../../lib/session";
import { validateWebsiteInput } from "../../../../lib/websites";

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

// Ownership check: the row must belong to the caller, or it is treated as
// not found (no existence leak to other users).
async function ownedWebsite(userId, id) {
  return prisma.website.findFirst({ where: { id, userId } });
}

export async function GET(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const website = await ownedWebsite(user.id, (await params).id);
  if (!website) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ website: safeWebsite(website) });
}

export async function PATCH(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const id = (await params).id;
  const existing = await ownedWebsite(user.id, id);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { errors, name, normalizedUrl } = validateWebsiteInput({
    name: body?.name,
    url: body?.url,
  });
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }
  try {
    const website = await prisma.website.update({
      where: { id },
      data: { name, normalizedUrl },
    });
    return NextResponse.json({ website: safeWebsite(website) });
  } catch (err) {
    if (err?.code === "P2002") {
      return NextResponse.json(
        { errors: { url: "You already registered this website." } },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Could not update this website. Try again." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const id = (await params).id;
  const existing = await ownedWebsite(user.id, id);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.website.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
