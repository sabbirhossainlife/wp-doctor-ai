// Tool 06 engine tests — redirect logic, policy revalidation, and
// redaction with injected transport/resolver plumbing (labelled: these
// are logic tests; real TLS truth comes from ssl-tls.test.js and
// ssl-integration.test.js, which use real tls.connect / pinnedRequest).
import test from "node:test";
import assert from "node:assert/strict";
import { runSslRedirectCheck } from "../lib/ssl/engine.js";
import { runSslRules } from "../lib/ssl/rules.js";
import { ScannerError } from "../lib/scanner/index.js";

const PUBLIC_IP = "93.184.216.34";
const PRIVATE_IP = "10.0.0.5";

function resolverFor(map) {
  return {
    resolve4: async (host) => {
      if (host in map) return [map[host]];
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    },
    resolve6: async () => [],
  };
}

function validTlsInfo(hostname, daysAhead = 365) {
  const to = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return {
    verified: true,
    authorizationError: null,
    protocol: "TLSv1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    peerCertificate: {
      subject: { CN: hostname },
      issuer: { O: "Test CA", CN: "Test CA" },
      valid_from: from.toUTCString(),
      valid_to: to.toUTCString(),
      subjectaltname: `DNS:${hostname}`,
    },
  };
}

// handler(req) => { status, headers } or throws ScannerError.
// req: { protocol, hostname, path }.
function transportFor(handler) {
  return async (req) => {
    const out = await handler(req);
    return { status: out.status, headers: out.headers ?? {}, bodyBytes: 0, bodyTruncated: false, durationMs: 1, ...(out.tlsInfo ? { tlsInfo: out.tlsInfo } : {}) };
  };
}

const resolverPublic = resolverFor({ "example.com": PUBLIC_IP, "other.com": PUBLIC_IP, "internal.example.com": PRIVATE_IP, "a.example.com": PUBLIC_IP, "b.example.com": PUBLIC_IP });

test("engine: http-only URL completes with HTTPS_NOT_ENFORCED, no TLS, query redacted", async () => {
  const r = await runSslRedirectCheck("http://example.com/page?token=secret-value#frag", {
    resolver: resolverPublic,
    transport: transportFor(() => ({ status: 200, headers: {} })),
  });
  assert.equal(r.executionStatus, "COMPLETED");
  assert.equal(r.sanitizedTargetUrl, "http://example.com/page");
  assert.ok(!JSON.stringify(r).includes("secret-value"));
  assert.equal(r.tlsOutcome, null);
  assert.equal(r.summary.certStatus, "NOT_APPLICABLE");
  assert.ok(r.findings.some((f) => f.code === "HTTPS_NOT_ENFORCED" && f.severity === "MEDIUM"));
  assert.ok(r.findings.some((f) => f.code === "REDIRECT_CHAIN_OK"));
  assert.equal(r.chain[0].status, 200);
  assert.equal(r.chain[0].outcome, "terminal");
});

test("engine: https valid cert completes with TLS_CERT_VALID and chain ok", async () => {
  const r = await runSslRedirectCheck("https://example.com/", {
    resolver: resolverPublic,
    transport: transportFor((req) => ({ status: 200, headers: {}, tlsInfo: validTlsInfo("example.com") })),
  });
  assert.equal(r.executionStatus, "COMPLETED");
  assert.equal(r.tlsOutcome.verified, true);
  assert.equal(r.tlsOutcome.certificate.hostname, "example.com");
  assert.equal(r.tlsOutcome.certificate.protocol, "TLSv1.3");
  assert.ok(r.findings.some((f) => f.code === "TLS_CERT_VALID" && f.severity === "LOW"));
  assert.ok(!r.findings.some((f) => f.code === "TLS_CERT_EXPIRING_SOON"));
});

test("engine: verified cert expiring in 10 days yields EXPIRING_SOON, not VALID", async () => {
  const r = await runSslRedirectCheck("https://example.com/", {
    resolver: resolverPublic,
    transport: transportFor((req) => ({ status: 200, headers: {}, tlsInfo: validTlsInfo("example.com", 10) })),
  });
  assert.ok(r.findings.some((f) => f.code === "TLS_CERT_EXPIRING_SOON" && f.severity === "MEDIUM"));
  assert.ok(!r.findings.some((f) => f.code === "TLS_CERT_VALID"));
  assert.equal(r.summary.certStatus, "EXPIRING_SOON");
});

test("engine: http->https upgrade yields HTTP_TO_HTTPS_REDIRECT + valid cert", async () => {
  const r = await runSslRedirectCheck("http://example.com/", {
    resolver: resolverPublic,
    transport: transportFor((req) => {
      if (req.protocol === "http:") return { status: 301, headers: { location: "https://example.com/" } };
      return { status: 200, headers: {}, tlsInfo: validTlsInfo("example.com") };
    }),
  });
  assert.equal(r.executionStatus, "COMPLETED");
  assert.ok(r.findings.some((f) => f.code === "HTTP_TO_HTTPS_REDIRECT"));
  assert.equal(r.chain[0].outcome, "followed");
  assert.equal(r.chain[0].destination, "https://example.com/");
  assert.equal(r.chain[1].outcome, "terminal");
});

test("engine: https->http downgrade is recorded and NOT followed", async () => {
  let httpCalls = 0;
  const r = await runSslRedirectCheck("https://example.com/", {
    resolver: resolverPublic,
    transport: transportFor((req) => {
      if (req.protocol === "http:") { httpCalls += 1; return { status: 200, headers: {} }; }
      return { status: 301, headers: { location: "http://example.com/" }, tlsInfo: validTlsInfo("example.com") };
    }),
  });
  assert.equal(httpCalls, 0, "no plain-HTTP request may follow a downgrade");
  assert.equal(r.executionStatus, "COMPLETED");
  assert.equal(r.terminalReason, "DOWNGRADE_BLOCKED");
  assert.ok(r.findings.some((f) => f.code === "DOWNGRADE_DETECTED_BLOCKED" && f.severity === "HIGH"));
  assert.equal(r.chain[0].outcome, "blocked");
  assert.equal(r.chain[0].destination, "http://example.com/");
  assert.equal(r.summary.downgradeBlocked, true);
});

test("engine: relative Location resolves against the current URL", async () => {
  const r = await runSslRedirectCheck("http://example.com/old", {
    resolver: resolverPublic,
    transport: transportFor((req) => {
      if (req.path === "/old") return { status: 302, headers: { location: "/new" } };
      return { status: 200, headers: {} };
    }),
  });
  assert.equal(r.executionStatus, "COMPLETED");
  assert.equal(r.chain[0].destination, "http://example.com/new");
  assert.equal(r.chain[1].url, "http://example.com/new");
});

test("engine: redirect loop stops as PARTIAL with REDIRECT_LOOP", async () => {
  const r = await runSslRedirectCheck("http://a.example.com/", {
    resolver: resolverPublic,
    transport: transportFor((req) => {
      if (req.hostname === "a.example.com") return { status: 301, headers: { location: "http://b.example.com/" } };
      return { status: 301, headers: { location: "http://a.example.com/" } };
    }),
  });
  assert.equal(r.executionStatus, "PARTIAL");
  assert.equal(r.terminalReason, "LOOP");
  assert.ok(r.findings.some((f) => f.code === "REDIRECT_LOOP"));
  assert.ok(r.findings.some((f) => f.code === "CROSS_HOST_REDIRECT" && f.severity === "LOW"));
});

test("engine: more than 5 redirects stops as PARTIAL with MAX_REDIRECTS_REACHED", async () => {
  let n = 0;
  const r = await runSslRedirectCheck("http://example.com/0", {
    resolver: resolverPublic,
    transport: transportFor(() => {
      n += 1;
      return { status: 301, headers: { location: `http://example.com/${n}` } };
    }),
  });
  assert.equal(r.executionStatus, "PARTIAL");
  assert.equal(r.terminalReason, "MAX_REDIRECTS");
  assert.ok(r.findings.some((f) => f.code === "MAX_REDIRECTS_REACHED"));
  assert.equal(n, 6, "initial hop + 5 redirects");
});

test("engine: malformed redirect target is rejected, not followed", async () => {
  const r = await runSslRedirectCheck("http://example.com/", {
    resolver: resolverPublic,
    transport: transportFor(() => ({ status: 301, headers: { location: "http://exa mple.com/" } })),
  });
  assert.equal(r.executionStatus, "PARTIAL");
  assert.equal(r.terminalReason, "DESTINATION_REJECTED");
  assert.ok(r.findings.some((f) => f.code === "REDIRECT_DESTINATION_REJECTED"));
  assert.equal(r.chain[0].outcome, "rejected");
});

test("engine: redirect to a private destination is rejected by policy revalidation", async () => {
  const r = await runSslRedirectCheck("http://example.com/", {
    resolver: resolverPublic,
    transport: transportFor((req) => {
      if (req.hostname === "example.com") return { status: 301, headers: { location: "http://internal.example.com/" } };
      return { status: 200, headers: {} };
    }),
  });
  assert.equal(r.executionStatus, "PARTIAL");
  assert.equal(r.terminalReason, "DESTINATION_REJECTED");
  assert.ok(r.findings.some((f) => f.code === "REDIRECT_DESTINATION_REJECTED"));
});

test("engine: cross-host redirect is reported neutrally (LOW, not malicious)", async () => {
  const r = await runSslRedirectCheck("http://a.example.com/", {
    resolver: resolverPublic,
    transport: transportFor((req) => {
      if (req.hostname === "a.example.com") return { status: 301, headers: { location: "http://b.example.com/" } };
      return { status: 200, headers: {} };
    }),
  });
  const cross = r.findings.find((f) => f.code === "CROSS_HOST_REDIRECT");
  assert.ok(cross);
  assert.equal(cross.severity, "LOW");
  assert.match(cross.explanation, /neutrally/);
  assert.ok(!/malicious/i.test(cross.title));
  assert.equal(r.chain[0].hostChanged, true);
});

test("engine: redirect hop with an expired cert completes as PARTIAL with TLS finding, no invented status", async () => {
  const r = await runSslRedirectCheck("http://example.com/", {
    resolver: resolverPublic,
    transport: transportFor((req) => {
      if (req.protocol === "http:") return { status: 301, headers: { location: "https://example.com/" } };
      throw new ScannerError("TLS_FAILURE", "CERT_HAS_EXPIRED");
    }),
  });
  assert.equal(r.executionStatus, "PARTIAL");
  assert.equal(r.tlsOutcome.errorCode, "TLS_CERT_EXPIRED");
  assert.equal(r.tlsOutcome.certificate, null);
  assert.ok(r.findings.some((f) => f.code === "TLS_CERT_EXPIRED" && f.severity === "HIGH"));
  assert.equal(r.chain[1].status, null);
  assert.equal(r.chain[1].outcome, "blocked");
});

test("engine: initial connection failure is FAILED with NETWORK_OR_TIMEOUT and no status", async () => {
  const r = await runSslRedirectCheck("https://example.com/", {
    resolver: resolverPublic,
    transport: transportFor(() => { throw new ScannerError("CONNECTION_FAILURE", "ECONNREFUSED"); }),
  });
  assert.equal(r.executionStatus, "FAILED");
  assert.ok(r.findings.some((f) => f.code === "NETWORK_OR_TIMEOUT"));
  assert.equal(r.chain[0].status, null);
});

test("engine: initial policy rejections are BLOCKED (loopback, scheme, port, credentials)", async () => {
  for (const url of [
    "http://127.0.0.1/",
    "ftp://example.com/",
    "http://example.com:8080/",
    "https://user:pass@example.com/",
    "http://localhost/",
  ]) {
    const r = await runSslRedirectCheck(url, {
      resolver: resolverPublic,
      transport: transportFor(() => ({ status: 200, headers: {} })),
    });
    assert.equal(r.executionStatus, "BLOCKED", url);
  }
});

test("engine: initial expired cert is COMPLETED (a cert failure is an observation, not a failed check)", async () => {
  const r = await runSslRedirectCheck("https://example.com/", {
    resolver: resolverPublic,
    transport: transportFor(() => { throw new ScannerError("TLS_FAILURE", "CERT_HAS_EXPIRED"); }),
  });
  assert.equal(r.executionStatus, "COMPLETED");
  assert.ok(r.findings.some((f) => f.code === "TLS_CERT_EXPIRED"));
});

test("rules: pure rule engine severity table", () => {
  const base = { executionStatus: "COMPLETED", chain: [{ url: "https://example.com/", status: 200, hostChanged: false, scheme: "https", outcome: "terminal" }], terminalReason: "TERMINAL_RESPONSE", initialScheme: "https", finalScheme: "https" };
  const valid = runSslRules({ ...base, tlsOutcome: { scheme: "https", verified: true, certificate: { hostname: "example.com", validTo: new Date(Date.now() + 400 * 86400000).toISOString() }, daysToExpiry: 400 } });
  assert.ok(valid.some((f) => f.code === "TLS_CERT_VALID"));
  const expired = runSslRules({ ...base, tlsOutcome: { scheme: "https", verified: false, errorCode: "TLS_CERT_EXPIRED", certificate: null, daysToExpiry: null } });
  assert.ok(expired.some((f) => f.code === "TLS_CERT_EXPIRED" && f.severity === "HIGH"));
  const insufficient = runSslRules({ ...base, tlsOutcome: { scheme: "https", verified: false, errorCode: "TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT", certificate: null, daysToExpiry: null } });
  assert.ok(insufficient.some((f) => f.code === "TLS_CERTIFICATE_EVIDENCE_INSUFFICIENT"));
});
