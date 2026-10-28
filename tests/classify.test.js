import test from "node:test";
import assert from "node:assert/strict";
import { classifySuccess, classifyError, SCAN_LIMITATION_NOTE } from "../lib/diagnostics/classify.js";

const chain = [{ url: "https://example.com/", protocol: "https:", status: 200, contentType: "text/html", bodyBytes: 10 }];

test("200 is a completed REACHABLE scan, not a failure", () => {
  const r = classifySuccess({ finalUrl: "https://example.com/", finalStatus: 200, redirectCount: 0, chain, durationMs: 42 });
  assert.equal(r.executionStatus, "COMPLETED");
  assert.equal(r.diagnosticOutcome, "REACHABLE");
  assert.match(r.findings[0].title, /200/);
});

test("404 is a completed scan with an HTTP error finding", () => {
  const r = classifySuccess({ finalUrl: "https://example.com/nope", finalStatus: 404, redirectCount: 0, chain, durationMs: 42 });
  assert.equal(r.executionStatus, "COMPLETED");
  assert.equal(r.diagnosticOutcome, "HTTP_ERROR_RESPONSE");
  assert.match(r.findings[0].title, /404/);
});

test("500 is a completed scan with a server-error finding, not a scanner failure", () => {
  const r = classifySuccess({ finalUrl: "https://example.com/", finalStatus: 500, redirectCount: 0, chain, durationMs: 42 });
  assert.equal(r.executionStatus, "COMPLETED");
  assert.equal(r.diagnosticOutcome, "HTTP_ERROR_RESPONSE");
  assert.equal(r.findings[0].severity, "high");
  assert.doesNotMatch(r.findings[0].description, /hosting server is broken/i);
});

test("terminal 3xx without a Location is a redirect problem", () => {
  const r = classifySuccess({ finalUrl: "https://example.com/", finalStatus: 301, redirectCount: 0, chain, durationMs: 42 });
  assert.equal(r.diagnosticOutcome, "REDIRECT_PROBLEM");
});

test("redirect chain adds an observation finding before the status finding", () => {
  const r = classifySuccess({
    finalUrl: "https://example.com/",
    finalStatus: 200,
    redirectCount: 1,
    chain: [
      { url: "http://example.com/", protocol: "http:", status: 301, contentType: null, bodyBytes: 0 },
      ...chain,
    ],
    durationMs: 42,
  });
  assert.equal(r.findings.length, 2);
  assert.match(r.findings[0].title, /Redirect chain/);
});

for (const [code, execution, outcome] of [
  ["INVALID_URL", "BLOCKED", "BLOCKED_BY_SECURITY_POLICY"],
  ["UNSUPPORTED_SCHEME", "BLOCKED", "BLOCKED_BY_SECURITY_POLICY"],
  ["UNSUPPORTED_PORT", "BLOCKED", "BLOCKED_BY_SECURITY_POLICY"],
  ["PROHIBITED_DESTINATION", "BLOCKED", "BLOCKED_BY_SECURITY_POLICY"],
  ["DNS_FAILURE", "FAILED", "DNS_FAILURE"],
  ["TLS_FAILURE", "FAILED", "TLS_FAILURE"],
  ["REQUEST_TIMEOUT", "FAILED", "TIMEOUT"],
  ["CONNECTION_FAILURE", "FAILED", "CONNECTION_FAILURE"],
  ["TOO_MANY_REDIRECTS", "FAILED", "REDIRECT_PROBLEM"],
  ["RATE_LIMITED", "FAILED", "INSUFFICIENT_EVIDENCE"],
  ["INTERNAL_SCANNER_ERROR", "FAILED", "INSUFFICIENT_EVIDENCE"],
]) {
  test(`error ${code} -> ${execution} / ${outcome}`, () => {
    const r = classifyError(code);
    assert.equal(r.executionStatus, execution);
    assert.equal(r.diagnosticOutcome, outcome);
    assert.equal(r.findings.length, 1);
  });
}

test("timeout recommendation never claims a root cause", () => {
  const r = classifyError("REQUEST_TIMEOUT");
  assert.doesNotMatch(r.findings[0].recommendation, /hosting server is broken/i);
  assert.doesNotMatch(r.findings[0].description, /hosting server is broken/i);
});

test("limitation note states the public-URL boundary", () => {
  assert.match(SCAN_LIMITATION_NOTE, /cannot reveal private PHP errors/);
  assert.match(SCAN_LIMITATION_NOTE, /database problems/);
  assert.match(SCAN_LIMITATION_NOTE, /plugin conflict/);
});
