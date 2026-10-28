import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { scanUrl } from "../lib/scanner/scanner.js";
import { pinnedRequest } from "../lib/scanner/transport.js";
import { makeTransport } from "./scanner-helpers.js";

const quiet = () => {};

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("real transport: overall timeout aborts a slow response", async () => {
  const server = await startServer((_req, res) => {
    setTimeout(() => {
      try {
        res.writeHead(200);
        res.end("slow");
      } catch {
        // client already gone
      }
    }, 5000);
  });
  const port = server.address().port;
  try {
    await assert.rejects(
      () =>
        pinnedRequest({
          protocol: "http:",
          hostname: "example.test",
          ip: "127.0.0.1",
          family: 4,
          port,
          path: "/",
          timeoutMs: 200,
          maxBytes: 1024,
        }),
      (e) => e.code === "REQUEST_TIMEOUT",
    );
  } finally {
    server.close();
  }
});

test("real transport: oversized body is rejected and the stream is destroyed", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("x".repeat(3000));
  });
  const port = server.address().port;
  try {
    await assert.rejects(
      () =>
        pinnedRequest({
          protocol: "http:",
          hostname: "example.test",
          ip: "127.0.0.1",
          family: 4,
          port,
          path: "/",
          timeoutMs: 5000,
          maxBytes: 1024,
        }),
      (e) => e.code === "RESPONSE_LIMIT_EXCEEDED",
    );
  } finally {
    server.close();
  }
});

test("real transport: aborted connection surfaces as a scanner error, not a crash", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200);
    res.write("partial");
    res.socket.destroy();
  });
  const port = server.address().port;
  try {
    await assert.rejects(
      () =>
        pinnedRequest({
          protocol: "http:",
          hostname: "example.test",
          ip: "127.0.0.1",
          family: 4,
          port,
          path: "/",
          timeoutMs: 5000,
          maxBytes: 1024,
        }),
      (e) => e instanceof Error && e.code !== undefined,
    );
  } finally {
    server.close();
  }
});

test("real transport: excessive headers are rejected, not accepted silently", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "x-huge": "y".repeat(20000) });
    res.end("ok");
  });
  const port = server.address().port;
  try {
    await assert.rejects(
      () =>
        pinnedRequest({
          protocol: "http:",
          hostname: "example.test",
          ip: "127.0.0.1",
          family: 4,
          port,
          path: "/",
          timeoutMs: 5000,
          maxBytes: 1024,
        }),
      (e) => e instanceof Error,
    );
  } finally {
    server.close();
  }
});

test("scanner DNS timeout via scanUrl uses the DNS limit", async () => {
  const hanging = {
    resolve4: () => new Promise(() => {}),
    resolve6: () => new Promise(() => {}),
  };
  const transport = makeTransport({});
  await assert.rejects(
    () =>
      scanUrl("https://example.com/", {
        resolver: hanging,
        transport,
        logger: quiet,
        limits: { dnsTimeoutMs: 50 },
      }),
    (e) => e.code === "DNS_FAILURE",
  );
  assert.equal(transport.calls.length, 0);
});
