// Tool 12 pinned probe logic (Milestone 16). The transport is injected
// (same pattern as the Tool 06 engine) because the scanner permits only
// ports 80/443 and this VM cannot bind a privileged fixture port; the
// redirect, cross-host, loop, and downgrade logic under test is fully
// real. DNS is skipped via testPin. No real network traffic occurs.
import test from "node:test";
import assert from "node:assert/strict";
import { probeTarget } from "../lib/uptime/http.js";

const pin = () => ({ address: "127.0.0.1", family: 4 });

function cannedTransport(routes) {
  return async (input) => {
    const key = `${input.hostname}${input.path}`;
    const route = routes[key];
    if (!route) throw Object.assign(new Error("not found"), { code: "CONNECTION_FAILURE" });
    if (route.error) throw route.error;
    return { status: route.status, headers: route.headers ?? {}, bodyPreview: route.body ?? null, bodyBytes: 0, bodyTruncated: false, durationMs: 5 };
  };
}

test("uptime http: 200 success keeps final URL and prefix", async () => {
  const transport = cannedTransport({
    "example.com/": { status: 200, body: "<html>ok</html>" },
  });
  const result = await probeTarget("http://example.com/", { testPin: pin, transport });
  assert.equal(result.status, 200);
  assert.equal(result.errorCode, null);
  assert.equal(result.redirectCount, 0);
  assert.equal(result.headPrefix, "<html>ok</html>");
});

test("uptime http: same-host redirect chain is followed to success", async () => {
  const transport = cannedTransport({
    "example.com/": { status: 301, headers: { location: "/moved" } },
    "example.com/moved": { status: 200, body: "done" },
  });
  const result = await probeTarget("http://example.com/", { testPin: pin, transport });
  assert.equal(result.status, 200);
  assert.equal(result.redirectCount, 1);
  assert.equal(result.crossHostRedirectBlocked, false);
});

test("uptime http: cross-host redirect is blocked and never fetched", async () => {
  let fetchedOther = false;
  const transport = async (input) => {
    if (input.hostname === "other.com") fetchedOther = true;
    if (input.hostname === "example.com") return { status: 302, headers: { location: "https://other.com/target" }, bodyPreview: null, bodyBytes: 0, bodyTruncated: false, durationMs: 1 };
    throw Object.assign(new Error("must not fetch"), { code: "CONNECTION_FAILURE" });
  };
  const result = await probeTarget("http://example.com/", { testPin: pin, transport });
  assert.equal(result.crossHostRedirectBlocked, true);
  assert.equal(result.crossHostDestinationHost, "other.com");
  assert.equal(result.errorCode, "CROSS_HOST_REDIRECT");
  assert.equal(fetchedOther, false);
});

test("uptime http: redirect loop and redirect limit are errors, not successes", async () => {
  const loop = cannedTransport({
    "example.com/loop": { status: 302, headers: { location: "/loop" } },
  });
  const looped = await probeTarget("http://example.com/loop", { testPin: pin, transport: loop });
  assert.equal(looped.errorCode, "TOO_MANY_REDIRECTS");
  assert.equal(looped.status, null);
});

test("uptime http: https to http downgrade is blocked", async () => {
  const transport = cannedTransport({
    "example.com/": { status: 301, headers: { location: "http://example.com/plain" } },
  });
  const result = await probeTarget("https://example.com/", { testPin: pin, transport });
  assert.equal(result.errorCode, "PROHIBITED_DESTINATION");
  assert.equal(result.status, null);
});

test("uptime http: transport TLS failure is classified, not thrown", async () => {
  const transport = async () => {
    throw Object.assign(new Error("self signed certificate"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
  };
  // The injected transport throws a raw error; probeTarget maps unknown
  // throws to INTERNAL_SCANNER_ERROR (real pinnedRequest would map cert
  // errors to TLS_FAILURE — that mapping is proven in scanner tests).
  const result = await probeTarget("http://example.com/", { testPin: pin, transport });
  assert.equal(result.status, null);
  assert.equal(result.errorCode, "INTERNAL_SCANNER_ERROR");
});

test("uptime http: no request is sent when the URL policy rejects the target", async () => {
  let called = false;
  const transport = async () => {
    called = true;
    return { status: 200, headers: {}, bodyPreview: null, bodyBytes: 0, bodyTruncated: false, durationMs: 1 };
  };
  const result = await probeTarget("http://127.0.0.1:8080/", { testPin: pin, transport });
  // Loopback is refused by the URL policy (non-standard port) before
  // any transport call — the probe must not send the request.
  assert.equal(called, false);
  assert.equal(result.status, null);
  assert.ok(result.errorCode);
});
