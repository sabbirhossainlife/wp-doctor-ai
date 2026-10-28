import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/health/route.js";

test("health route returns 200 with status ok and service name", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { status: "ok", service: "wp-doctor-ai" });
});
