import test from "node:test";
import assert from "node:assert/strict";
import { scanUrl } from "../lib/scanner/scanner.js";
import { makeResolver, makeTransport, PUBLIC_V4 } from "./scanner-helpers.js";

const quiet = () => {};

// Rebinding simulation: the resolver returns a public address on the first
// lookup and a private address on every later lookup for the same host.
// A naive client that re-resolves at connect time would hit the private
// address; the scanner must still connect to the validated (first) one.
test("rebinding: transport receives the validated IP even after DNS changes", async () => {
  let calls = 0;
  const resolver = {
    resolve4: async () => {
      calls += 1;
      return calls === 1 ? [PUBLIC_V4] : ["10.0.0.99"];
    },
    resolve6: async () => [],
  };
  const transport = makeTransport({ "example.com": { status: 200, headers: {} } });
  const result = await scanUrl("https://example.com/", {
    resolver,
    transport,
    logger: quiet,
  });
  assert.equal(result.ok, true);
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].ip, PUBLIC_V4);
  assert.equal(transport.calls[0].hostname, "example.com");
  // Prove the rebinding actually happened behind the scan: a second
  // resolution now returns the private address — a client that re-resolved
  // at connect time would have hit it. The scanner did not.
  assert.deepEqual(await resolver.resolve4("example.com"), ["10.0.0.99"]);
});

test("a prohibited address never reaches the transport", async () => {
  const resolver = makeResolver({ "example.com": { v4: ["127.0.0.1"], v6: [] } });
  const transport = makeTransport({});
  await assert.rejects(
    () => scanUrl("https://example.com/", { resolver, transport, logger: quiet }),
    (e) => e.code === "PROHIBITED_DESTINATION",
  );
  assert.equal(transport.calls.length, 0);
});

test("no retry or fallback after a transport failure", async () => {
  const resolver = makeResolver({ "example.com": { v4: [PUBLIC_V4], v6: [] } });
  const { ScannerError } = await import("../lib/scanner/errors.js");
  const transport = makeTransport({
    "example.com": new ScannerError("CONNECTION_FAILURE", "refused"),
  });
  await assert.rejects(
    () => scanUrl("https://example.com/", { resolver, transport, logger: quiet }),
    (e) => e.code === "CONNECTION_FAILURE",
  );
  assert.equal(transport.calls.length, 1);
});

test("scanner passes fixed safe headers only (no user headers reach transport)", async () => {
  const resolver = makeResolver({ "example.com": { v4: [PUBLIC_V4], v6: [] } });
  const transport = makeTransport({ "example.com": { status: 200, headers: {} } });
  await scanUrl("https://example.com/?token=secret-value", {
    resolver,
    transport,
    logger: quiet,
  });
  const call = transport.calls[0];
  assert.ok(!("headers" in call) || call.headers === undefined);
  assert.equal(call.path, "/?token=secret-value"); // request target is fine; logs must not contain it
});
