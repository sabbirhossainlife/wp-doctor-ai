// Tool 06 integration tests — REAL engine + REAL pinned transport
// against REAL local servers on ports 80/443 (the VM runs as root, so
// standard ports bind). The ONLY non-production seam is `testPin`, an
// in-process engine dependency that maps test hostnames to 127.0.0.1,
// bypassing ONLY the DNS/IP-policy stage for loopback fixtures (the
// fail-closed policy would otherwise — correctly — block loopback).
// The TLS handshake, hostname verification, HTTP exchange, and redirect
// handling are all real. The service and all routes never pass testPin.
import test from "node:test";
import assert from "node:assert/strict";
import { runSslRedirectCheck } from "../lib/ssl/engine.js";
import { generateSslFixtures, startHttps, startHttp, closeAsync } from "./ssl-fixtures.js";

let fx;
test.before(() => { fx = generateSslFixtures(); });
test.after(() => { fx?.cleanup(); });

const testPin = () => ({ address: "127.0.0.1", family: 4 });
const ok = (req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); };

test("integration: valid cert via real engine + pinned transport on 443", async () => {
  const httpsServer = await startHttps(443, fx.valid, ok);
  try {
    const r = await runSslRedirectCheck("https://valid.example.test/", { testPin, tlsCa: fx.caCert });
    assert.equal(r.executionStatus, "COMPLETED");
    assert.equal(r.tlsOutcome.verified, true);
    assert.equal(r.tlsOutcome.certificate.hostname, "valid.example.test");
    assert.ok(r.tlsOutcome.certificate.validTo);
    assert.ok(r.tlsOutcome.certificate.protocol, "protocol actually observed");
    assert.ok(r.tlsOutcome.certificate.cipher, "cipher actually observed");
    assert.ok(r.findings.some((f) => f.code === "TLS_CERT_VALID"));
    assert.equal(r.chain[0].status, 200);
  } finally { await closeAsync(httpsServer); }
});

test("integration: expired cert via real engine on 443", async () => {
  const httpsServer = await startHttps(443, fx.expired, ok);
  try {
    const r = await runSslRedirectCheck("https://valid.example.test/", { testPin, tlsCa: fx.caCert });
    assert.equal(r.executionStatus, "COMPLETED");
    assert.equal(r.tlsOutcome.verified, false);
    assert.equal(r.tlsOutcome.errorCode, "TLS_CERT_EXPIRED");
    assert.equal(r.tlsOutcome.certificate, null);
    assert.ok(r.findings.some((f) => f.code === "TLS_CERT_EXPIRED"));
    assert.equal(r.chain[0].status, null, "no HTTP status invented for a failed handshake");
  } finally { await closeAsync(httpsServer); }
});

test("integration: hostname mismatch via real engine on 443", async () => {
  const httpsServer = await startHttps(443, fx.mismatch, ok);
  try {
    const r = await runSslRedirectCheck("https://valid.example.test/", { testPin, tlsCa: fx.caCert });
    assert.equal(r.tlsOutcome.errorCode, "TLS_HOSTNAME_MISMATCH");
    assert.ok(r.findings.some((f) => f.code === "TLS_HOSTNAME_MISMATCH"));
  } finally { await closeAsync(httpsServer); }
});

test("integration: self-signed cert without the test CA is untrusted in production mode (no CA passed)", async () => {
  const httpsServer = await startHttps(443, fx.selfSigned, ok);
  try {
    const r = await runSslRedirectCheck("https://valid.example.test/", { testPin });
    assert.equal(r.tlsOutcome.errorCode, "TLS_CERT_UNTRUSTED");
    assert.ok(r.findings.some((f) => f.code === "TLS_CERT_UNTRUSTED"));
  } finally { await closeAsync(httpsServer); }
});

test("integration: http on 80 redirects to https on 443 (real chain)", async () => {
  const httpsServer = await startHttps(443, fx.valid, ok);
  const httpServer = await startHttp(80, (req, res) => {
    res.writeHead(301, { Location: "https://valid.example.test/" });
    res.end();
  });
  try {
    const r = await runSslRedirectCheck("http://valid.example.test/", { testPin, tlsCa: fx.caCert });
    assert.equal(r.executionStatus, "COMPLETED");
    assert.ok(r.findings.some((f) => f.code === "HTTP_TO_HTTPS_REDIRECT"));
    assert.ok(r.findings.some((f) => f.code === "TLS_CERT_VALID"));
    assert.equal(r.chain.length, 2);
    assert.equal(r.chain[0].outcome, "followed");
    assert.equal(r.chain[1].status, 200);
  } finally { await closeAsync(httpServer); await closeAsync(httpsServer); }
});

test("integration: http-only on 80 never reaches https", async () => {
  const httpServer = await startHttp(80, ok);
  try {
    const r = await runSslRedirectCheck("http://valid.example.test/", { testPin });
    assert.equal(r.executionStatus, "COMPLETED");
    assert.ok(r.findings.some((f) => f.code === "HTTPS_NOT_ENFORCED"));
    assert.equal(r.tlsOutcome, null);
  } finally { await closeAsync(httpServer); }
});

test("integration: redirect loop on 80 stops as PARTIAL", async () => {
  const httpServer = await startHttp(80, (req, res) => {
    res.writeHead(301, { Location: "http://valid.example.test/" });
    res.end();
  });
  try {
    const r = await runSslRedirectCheck("http://valid.example.test/", { testPin });
    assert.equal(r.executionStatus, "PARTIAL");
    assert.equal(r.terminalReason, "LOOP");
  } finally { await closeAsync(httpServer); }
});
