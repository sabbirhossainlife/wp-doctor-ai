// Tool 06 core TLS tests — REAL TLS verification, no mocks for the core
// cases. Local fixture servers (openssl-generated certs) are probed with
// the production probeTls(): tls.connect to a pinned IP, servername =
// hostname, default CA store unless the test CA is explicitly injected,
// rejectUnauthorized never disabled.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeTls, classifyTlsError } from "../lib/ssl/tls-probe.js";
import { generateSslFixtures, startHttps, startHttp, startSilent, closeAsync } from "./ssl-fixtures.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fx;

test.before(() => { fx = generateSslFixtures(); });
test.after(() => { fx?.cleanup(); });

test("tls: valid trusted cert + matching hostname verifies with metadata", async () => {
  const server = await startHttps(0, fx.valid, (req, res) => { res.end("ok"); });
  try {
    const r = await probeTls({ host: "127.0.0.1", port: server.address().port, servername: "valid.example.test", ca: fx.caCert, timeoutMs: 5000 });
    assert.equal(r.verified, true);
    assert.equal(r.errorCode, null);
    assert.equal(r.certificate.hostname, "valid.example.test");
    assert.ok(r.certificate.validTo);
    assert.ok(new Date(r.certificate.validTo).getTime() > Date.now());
    assert.ok(r.certificate.san.includes("valid.example.test"));
    assert.ok(r.protocol, "protocol observed");
    assert.ok(r.cipher, "cipher observed");
    assert.match(r.certificate.issuer ?? "", /WP Doctor Test CA/);
  } finally { await closeAsync(server); }
});

test("tls: expired cert fails with TLS_CERT_EXPIRED and no metadata", async () => {
  const server = await startHttps(0, fx.expired, (req, res) => { res.end("ok"); });
  try {
    const r = await probeTls({ host: "127.0.0.1", port: server.address().port, servername: "valid.example.test", ca: fx.caCert, timeoutMs: 5000 });
    assert.equal(r.verified, false);
    assert.equal(r.errorCode, "TLS_CERT_EXPIRED");
    assert.equal(r.certificate, null);
  } finally { await closeAsync(server); }
});

test("tls: not-yet-valid cert fails with TLS_CERT_NOT_YET_VALID and no metadata", async () => {
  const server = await startHttps(0, fx.notYetValid, (req, res) => { res.end("ok"); });
  try {
    const r = await probeTls({ host: "127.0.0.1", port: server.address().port, servername: "future.example.test", ca: fx.caCert, timeoutMs: 5000 });
    assert.equal(r.verified, false);
    assert.equal(r.errorCode, "TLS_CERT_NOT_YET_VALID");
    assert.equal(r.certificate, null);
  } finally { await closeAsync(server); }
});

test("tls: trusted cert with hostname mismatch fails with TLS_HOSTNAME_MISMATCH", async () => {
  const server = await startHttps(0, fx.mismatch, (req, res) => { res.end("ok"); });
  try {
    const r = await probeTls({ host: "127.0.0.1", port: server.address().port, servername: "valid.example.test", ca: fx.caCert, timeoutMs: 5000 });
    assert.equal(r.verified, false);
    assert.equal(r.errorCode, "TLS_HOSTNAME_MISMATCH");
    assert.equal(r.certificate, null);
  } finally { await closeAsync(server); }
});

test("tls: self-signed cert without the test CA fails with TLS_CERT_UNTRUSTED", async () => {
  const server = await startHttps(0, fx.selfSigned, (req, res) => { res.end("ok"); });
  try {
    const r = await probeTls({ host: "127.0.0.1", port: server.address().port, servername: "valid.example.test", timeoutMs: 5000 });
    assert.equal(r.verified, false);
    assert.equal(r.errorCode, "TLS_CERT_UNTRUSTED");
    assert.equal(r.certificate, null);
  } finally { await closeAsync(server); }
});

test("tls: handshake failure against a plain HTTP server", async () => {
  const server = await startHttp(0, (req, res) => { res.end("ok"); });
  try {
    const r = await probeTls({ host: "127.0.0.1", port: server.address().port, servername: "valid.example.test", ca: fx.caCert, timeoutMs: 5000 });
    assert.equal(r.verified, false);
    assert.equal(r.errorCode, "TLS_HANDSHAKE_FAILED");
    assert.equal(r.certificate, null);
  } finally { await closeAsync(server); }
});

test("tls: silent server times out with TLS_TIMEOUT", async () => {
  const server = await startSilent(0);
  try {
    const r = await probeTls({ host: "127.0.0.1", port: server.address().port, servername: "valid.example.test", ca: fx.caCert, timeoutMs: 500 });
    assert.equal(r.verified, false);
    assert.equal(r.errorCode, "TLS_TIMEOUT");
  } finally { await closeAsync(server); }
});

test("tls: SNI/hostname verification against a pinned IP (127.0.0.1, not the hostname)", async () => {
  // The probe connects to 127.0.0.1 while verifying against
  // valid.example.test — a wrong servername must fail even though the
  // cert is valid for its own name.
  const server = await startHttps(0, fx.valid, (req, res) => { res.end("ok"); });
  try {
    const good = await probeTls({ host: "127.0.0.1", port: server.address().port, servername: "valid.example.test", ca: fx.caCert, timeoutMs: 5000 });
    assert.equal(good.verified, true);
    const bad = await probeTls({ host: "127.0.0.1", port: server.address().port, servername: "wrong.example.test", ca: fx.caCert, timeoutMs: 5000 });
    assert.equal(bad.verified, false);
    assert.equal(bad.errorCode, "TLS_HOSTNAME_MISMATCH");
  } finally { await closeAsync(server); }
});

test("tls: production code never disables verification (strict check)", () => {
  for (const file of ["lib/ssl/tls-probe.js", "lib/scanner/transport.js", "lib/ssl/engine.js"]) {
    const src = readFileSync(path.join(root, file), "utf8");
    assert.ok(!src.includes("rejectUnauthorized: false"), `${file} must not disable verification`);
    assert.ok(!src.includes("rejectUnauthorized:false"), `${file} must not disable verification`);
  }
  assert.equal(classifyTlsError({ code: "CERT_HAS_EXPIRED" }), "TLS_CERT_EXPIRED");
  assert.equal(classifyTlsError({ code: "CERT_NOT_YET_VALID" }), "TLS_CERT_NOT_YET_VALID");
  assert.equal(classifyTlsError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }), "TLS_HOSTNAME_MISMATCH");
  assert.equal(classifyTlsError({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }), "TLS_CERT_UNTRUSTED");
});
