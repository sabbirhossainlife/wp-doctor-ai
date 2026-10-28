import test from "node:test";
import assert from "node:assert/strict";
import { scanUrl } from "../lib/scanner/scanner.js";
import { makeResolver, makeTransport, PUBLIC_V4 } from "./scanner-helpers.js";

const quiet = () => {};
const pub = (host) => ({ [host]: { v4: [PUBLIC_V4], v6: [] } });

test("follows 301/302/303/307/308, relative and absolute", async () => {
  for (const code of [301, 302, 303, 307, 308]) {
    const resolver = makeResolver(pub("example.com"));
    const transport = makeTransport({
      "example.com": (input) =>
        input.path === "/start"
          ? { status: code, headers: { location: "/end" }, bodyBytes: 0 }
          : { status: 200, headers: {}, bodyBytes: 0 },
    });
    const result = await scanUrl("https://example.com/start", { resolver, transport, logger: quiet });
    assert.equal(result.finalStatus, 200, `status ${code}`);
    assert.equal(result.redirectCount, 1);
  }
  const resolver = makeResolver(pub("example.com"));
  const transport = makeTransport({
    "example.com": (input) =>
      input.path === "/start"
        ? { status: 302, headers: { location: "https://example.com/end" }, bodyBytes: 0 }
        : { status: 200, headers: {}, bodyBytes: 0 },
  });
  const result = await scanUrl("https://example.com/start", { resolver, transport, logger: quiet });
  assert.equal(result.finalStatus, 200);
});

test("redirect loop is rejected", async () => {
  const resolver = makeResolver(pub("example.com"));
  // /start -> /loop -> /loop (loop on second visit to /loop)
  const looping = makeTransport({
    "example.com": (input) =>
      input.path === "/start"
        ? { status: 302, headers: { location: "/loop" }, bodyBytes: 0 }
        : { status: 302, headers: { location: "/loop" }, bodyBytes: 0 },
  });
  await assert.rejects(
    () => scanUrl("https://example.com/start", { resolver, transport: looping, logger: quiet }),
    (e) => e.code === "TOO_MANY_REDIRECTS",
  );
});

test("redirect limit of 5 is enforced", async () => {
  const resolver = makeResolver(pub("example.com"));
  const transport = makeTransport({
    "example.com": (input) => {
      const n = Number(input.path.slice(2)) || 0;
      return { status: 302, headers: { location: `/p${n + 1}` }, bodyBytes: 0 };
    },
  });
  await assert.rejects(
    () => scanUrl("https://example.com/p0", { resolver, transport, logger: quiet }),
    (e) => e.code === "TOO_MANY_REDIRECTS",
  );
  assert.ok(transport.calls.length <= 6);
});

test("redirects to private IP, IPv6 loopback, bad port, bad scheme are rejected", async () => {
  const cases = [
    ["http://127.0.0.1/", "private literal redirect"],
    ["http://[::1]/", "ipv6 loopback redirect"],
    ["https://example.com:8080/x", "prohibited port redirect"],
    ["ftp://example.com/x", "unsupported scheme redirect"],
    ["http:///broken", "malformed redirect"],
  ];
  for (const [location, label] of cases) {
    const resolver = makeResolver(pub("example.com"));
    const transport = makeTransport({
      "example.com": (input) =>
        input.path === "/start"
          ? { status: 302, headers: { location }, bodyBytes: 0 }
          : { status: 200, headers: {}, bodyBytes: 0 },
    });
    await assert.rejects(
      () => scanUrl("https://example.com/start", { resolver, transport, logger: quiet }),
      (e) => ["PROHIBITED_DESTINATION", "UNSUPPORTED_PORT", "UNSUPPORTED_SCHEME", "INVALID_URL"].includes(e.code),
      label,
    );
  }
});

test("redirect to a host with mixed DNS answers is rejected", async () => {
  const resolver = makeResolver({
    "example.com": { v4: [PUBLIC_V4], v6: [] },
    "evil.example": { v4: [PUBLIC_V4, "192.168.1.9"], v6: [] },
  });
  const transport = makeTransport({
    "example.com": { status: 302, headers: { location: "https://evil.example/" }, bodyBytes: 0 },
  });
  await assert.rejects(
    () => scanUrl("https://example.com/", { resolver, transport, logger: quiet }),
    (e) => e.code === "PROHIBITED_DESTINATION",
  );
});

test("HTTPS -> HTTP downgrade is rejected; HTTP -> HTTPS is allowed", async () => {
  const resolver = makeResolver(pub("example.com"));
  const down = makeTransport({
    "example.com": (input) =>
      input.path === "/start"
        ? { status: 302, headers: { location: "http://example.com/end" }, bodyBytes: 0 }
        : { status: 200, headers: {}, bodyBytes: 0 },
  });
  await assert.rejects(
    () => scanUrl("https://example.com/start", { resolver, transport: down, logger: quiet }),
    (e) => e.code === "PROHIBITED_DESTINATION",
  );
  const up = makeTransport({
    "example.com": (input) =>
      input.path === "/start"
        ? { status: 302, headers: { location: "https://example.com/end" }, bodyBytes: 0 }
        : { status: 200, headers: {}, bodyBytes: 0 },
  });
  const result = await scanUrl("http://example.com/start", { resolver, transport: up, logger: quiet });
  assert.equal(result.finalStatus, 200);
});

test("a 3xx without Location is a completed result, not an error", async () => {
  const resolver = makeResolver(pub("example.com"));
  const transport = makeTransport({
    "example.com": { status: 301, headers: {}, bodyBytes: 0 },
  });
  const result = await scanUrl("https://example.com/", { resolver, transport, logger: quiet });
  assert.equal(result.ok, true);
  assert.equal(result.finalStatus, 301);
});
