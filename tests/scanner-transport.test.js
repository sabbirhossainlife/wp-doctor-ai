import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinnedRequest } from "../lib/scanner/transport.js";

// Proves pinning at the real transport layer: the hostname "example.test"
// does not resolve in this environment, yet the request succeeds — because
// the socket goes to the pinned IP (the local server), not to a DNS answer
// for the hostname. The server also confirms the Host header and the
// connecting address.
test("real transport connects to the pinned IP, keeps the hostname in Host", async () => {
  const seen = {};
  const server = http.createServer((req, res) => {
    seen.hostHeader = req.headers.host;
    seen.remoteAddress = req.socket.remoteAddress;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("pinned-ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await pinnedRequest({
      protocol: "http:",
      hostname: "example.test",
      ip: "127.0.0.1",
      family: 4,
      port,
      path: "/hello",
      timeoutMs: 5000,
      maxBytes: 1024,
    });
    assert.equal(result.status, 200);
    assert.equal(seen.hostHeader, "example.test");
    assert.equal(seen.remoteAddress, "127.0.0.1");
  } finally {
    server.close();
  }
});

test("real transport fails closed when the pinned IP refuses (no DNS fallback)", async () => {
  // Port 1 on loopback refuses; example.test would fail DNS anyway, so a
  // connection error here proves no silent fallback path succeeded.
  await assert.rejects(
    () =>
      pinnedRequest({
        protocol: "http:",
        hostname: "example.test",
        ip: "127.0.0.1",
        family: 4,
        port: 1,
        path: "/",
        timeoutMs: 3000,
        maxBytes: 1024,
      }),
    (e) => e.code === "CONNECTION_FAILURE",
  );
});

// TLS verification must stay enabled: a self-signed server for the pinned
// hostname must be REJECTED (TLS_FAILURE), never silently accepted. The
// cert is generated with openssl at test time; if openssl is unavailable
// the test is skipped (reported, not passed).
test("real transport rejects a self-signed certificate (TLS verification on)", async (t) => {
  let opensslOk = true;
  try {
    execSync("openssl version", { stdio: "ignore" });
  } catch {
    opensslOk = false;
  }
  if (!opensslOk) {
    t.skip("openssl unavailable — TLS self-signed test skipped");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "wpd-tls-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj "/CN=example.test" -addext "subjectAltName=DNS:example.test"`,
    { stdio: "ignore" },
  );
  const { readFileSync } = await import("node:fs");
  const server = https.createServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    (_req, res) => {
      res.writeHead(200);
      res.end("tls-ok");
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await assert.rejects(
      () =>
        pinnedRequest({
          protocol: "https:",
          hostname: "example.test",
          ip: "127.0.0.1",
          family: 4,
          port,
          path: "/",
          timeoutMs: 5000,
          maxBytes: 1024,
        }),
      (e) => e.code === "TLS_FAILURE",
    );
  } finally {
    server.close();
  }
});
