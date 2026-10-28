// Plain Response (no next/server import) so the handler is also directly
// testable with the Node test runner. Next.js Route Handlers accept a
// standard Response return value.
export function GET() {
  return Response.json({ status: "ok", service: "wp-doctor-ai" });
}
