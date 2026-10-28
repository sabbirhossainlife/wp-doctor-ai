import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/session";
import { createPairingIntent, safeConnectorMessage } from "../../../../lib/connector/service";

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  let body;
  try {
    const text = await request.text();
    if (text.length > 10 * 1024) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // Mass-assignment guard: only websiteId is read.
  const websiteId = typeof body?.websiteId === "string" ? body.websiteId : null;
  if (!websiteId) return NextResponse.json({ error: "A website is required." }, { status: 400 });
  try {
    const result = await createPairingIntent({ userId: user.id, websiteId });
    if (!result.ok && result.error === "NOT_FOUND") {
      return NextResponse.json({ error: "Website not found." }, { status: 404 });
    }
    if (!result.ok && result.error === "RATE_LIMITED") {
      return NextResponse.json({ error: safeConnectorMessage("RATE_LIMITED") }, { status: 429 });
    }
    if (!result.ok) {
      return NextResponse.json({ error: "Could not create a pairing code. Try again." }, { status: 500 });
    }
    // The raw code is returned ONCE here and never again.
    return NextResponse.json(
      { code: result.code, expiresAt: result.expiresAt },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: "Could not create a pairing code. Try again." }, { status: 500 });
  }
}
