// Tool 07 DB tests. Run via scripts/run-db-tests.mjs with
// TEST_DATABASE_URL. DNS is injected (deterministic fixtures) — no live
// DNS, no email send, no form submission. Ownership, stale-snapshot
// blocking, and sanitized storage are tested against the real database.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import { createContactEmailDiagnostic, getContactEmailDiagnostic, listContactEmailDiagnostics, ContactEmailError } from "../lib/contact-email/service.js";
import { generateContactEmailAiAnalysis } from "../lib/contact-email/ai.js";
import { MockProvider } from "../lib/ai/providers.js";
import { buildContactEmailAiMessages } from "../lib/contact-email/ai-prompt.js";
import { ContactEmailRateLimiter } from "../lib/contact-email/rate-limit.js";
import { AiRateLimiter } from "../lib/ai/rate-limit.js";

const RUN = `ce-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let userA, userB, websiteA, connectionA;

const SENTINEL = "SENTINEL_SECRET_XYZ_9f8e7d";

function fixtureResolver(host) {
  if (host === "example.com") return Promise.resolve([["v=spf1 include:_spf.example.com ~all"]]);
  if (host === "_dmarc.example.com") return Promise.resolve([["v=DMARC1; p=none"]]);
  if (host === "google._domainkey.example.com") return Promise.resolve([["v=DKIM1; k=rsa; p=MIGfMA0"]]);
  return Promise.reject(new Error("NXDOMAIN"));
}

function v5Payload() {
  return {
    schemaVersion: 5,
    wordpressVersion: "7.1.3",
    phpVersion: "8.3.6",
    homeUrl: "https://example.com",
    siteUrl: "https://example.com",
    pluginVersion: "1.4.0",
    activePlugins: [{ name: "Contact Form 7", version: "6.2.3" }],
    activeTheme: { name: "Oishi", version: "1.0" },
    multisite: false,
    locale: "en_US",
    plugins: [
      { name: "Contact Form 7", slug: "contact-form-7", version: "6.2.3", active: true, networkActive: false, muPlugin: false, requiresWP: "7.1", requiresPHP: "8.3", dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: null },
      { name: "WP Mail SMTP", slug: "wp-mail-smtp", version: "4.0.0", active: true, networkActive: false, muPlugin: false, requiresWP: null, requiresPHP: null, dependencies: [], updateAvailable: false, newVersion: null, updateCheckedAt: null },
    ],
    theme: null,
    woocommerce: { installed: false, active: false, version: null, status: "NOT_INSTALLED", pages: { cart: null, checkout: null, myAccount: null }, gateways: [] },
    elementor: { installed: false, active: false, version: null, pro: { installed: false, active: false, version: null }, status: "NOT_INSTALLED" },
    environment: { phpMemoryLimit: null, wpMemoryLimit: null, maxExecutionTime: null },
    contactForms: [
      { pluginId: "contact-form-7", name: "Contact Form 7", installed: true, active: true, version: "6.2.3", adapterName: "contact-form-7", adapterVersion: "1", coverage: "COMPLETE", formsCount: 1, notificationConfigured: "yes", mailConfigStatus: "CONFIGURED" },
    ],
    mailTransport: [
      { pluginId: "wp-mail-smtp", name: "WP Mail SMTP", installed: true, active: true, version: "4.0.0", configPresent: "yes", requiredFieldsComplete: "yes", mailer: "smtp", senderConfigured: "yes", senderDomain: "example.com", coverage: "PARTIAL" },
    ],
    senderDomain: { senderConfigured: "yes", senderDomain: "example.com", domainMatches: null, comparisonEstablished: false },
  };
}

function ceAnalysis(findingId) {
  return {
    schemaVersion: "contact-email-1",
    summary: "SPF is present and DMARC is monitoring only.",
    explanation: "The deterministic report shows a present SPF record and a monitoring DMARC policy.",
    diagnosticConfidence: "HIGH",
    confirmedObservations: [{ findingId, observation: "An SPF record was found." }],
    causeHypotheses: [],
    recommendedActions: [],
    missingEvidence: ["DKIM selector"],
    limitations: ["Delivery was not verified."],
    humanReviewRecommended: false,
  };
}

test("db setup: users + owned website + ACTIVE connection + fresh v5 snapshot", async () => {
  userA = await prisma.user.create({ data: { name: "CE A", email: `${RUN}-a@example.invalid` } });
  userB = await prisma.user.create({ data: { name: "CE B", email: `${RUN}-b@example.invalid` } });
  websiteA = await prisma.website.create({ data: { name: "Example", normalizedUrl: "https://example.com/", userId: userA.id, connectionStatus: "CONNECTED" } });
  connectionA = await prisma.websiteConnection.create({ data: { websiteId: websiteA.id, status: "ACTIVE", credentialHash: "hash" } });
  await prisma.connectorDiagnosticSnapshot.create({ data: { connectionId: connectionA.id, websiteId: websiteA.id, schemaVersion: 5, payload: v5Payload() } });
  assert.ok(userA.id && websiteA.id && connectionA.id);
});

test("website run COMPLETED; client findings/snapshots ignored; sentinel never stored", async () => {
  const d = await createContactEmailDiagnostic(userA.id, {
    url: "https://evil.example/?token=<redacted>#frag",
    websiteId: websiteA.id,
    findings: [{ code: "FAKE", severity: "HIGH" }],
    snapshot: { contactForms: [{ pluginId: "evil", recipient: SENTINEL }] },
    userId: userB.id,
  }, { dnsResolver: fixtureResolver, limiter: new ContactEmailRateLimiter() });
  assert.equal(d.executionStatus, "COMPLETED");
  assert.equal(d.websiteId, websiteA.id);
  assert.equal(d.sanitizedTargetUrl, "https://example.com/");
  assert.equal(d.sanitizedEmailDomain, "example.com");
  assert.ok(!JSON.stringify(d).includes("FAKE"));
  assert.ok(!JSON.stringify(d).includes(SENTINEL));
  assert.ok(!JSON.stringify(d).includes("evil.example"));
  const codes = d.findings.map((f) => f.code);
  assert.ok(codes.includes("SPF_RECORD_PRESENT"));
  assert.ok(codes.includes("DMARC_POLICY_MONITORING"));
  assert.ok(codes.includes("DELIVERY_NOT_VERIFIED"));
  const row = await prisma.contactEmailDiagnostic.findUnique({ where: { id: d.id }, include: { findings: true } });
  assert.equal(row.userId, userA.id);
  assert.ok(!JSON.stringify(row).includes(SENTINEL));
});

test("URL-only run: DNS findings only, snapshot insufficient, no send/submit path", async () => {
  let dnsCalls = 0;
  const counting = (host) => { dnsCalls += 1; return fixtureResolver(host); };
  const d = await createContactEmailDiagnostic(userA.id, {
    url: "https://example.com/page?token=<redacted>#frag",
    emailDomain: "example.com",
    dkimSelector: "google",
  }, { dnsResolver: counting, limiter: new ContactEmailRateLimiter() });
  assert.equal(d.executionStatus, "COMPLETED");
  assert.equal(d.websiteId, null);
  assert.equal(d.snapshotSchemaVersion, null);
  assert.equal(d.sanitizedTargetUrl, "https://example.com/page");
  assert.ok(dnsCalls <= 3, "at most SPF + DMARC + DKIM lookups");
  const codes = d.findings.map((f) => f.code);
  assert.ok(codes.includes("EMAIL_EVIDENCE_INSUFFICIENT"));
  assert.ok(codes.includes("DKIM_RECORD_PRESENT"));
});

test("DNS failure preserves other findings as PARTIAL", async () => {
  const failing = (host) => (host === "example.com" ? Promise.reject(new Error("timeout")) : fixtureResolver(host));
  const d = await createContactEmailDiagnostic(userA.id, {
    url: "https://example.com/",
    emailDomain: "example.com",
  }, { dnsResolver: failing, limiter: new ContactEmailRateLimiter() });
  assert.equal(d.executionStatus, "PARTIAL");
  const codes = d.findings.map((f) => f.code);
  assert.ok(codes.includes("EMAIL_DNS_LOOKUP_FAILED"));
  assert.ok(codes.includes("DMARC_POLICY_MONITORING"));
});

test("invalid email domain / selector rejected; other user's website 404s", async () => {
  await assert.rejects(
    () => createContactEmailDiagnostic(userA.id, { url: "https://example.com/", emailDomain: "192.168.0.1" }, { dnsResolver: fixtureResolver, limiter: new ContactEmailRateLimiter() }),
    (err) => err instanceof ContactEmailError && err.code === "VALIDATION_FAILED",
  );
  await assert.rejects(
    () => createContactEmailDiagnostic(userA.id, { url: "https://example.com/", dkimSelector: "bad selector!" }, { dnsResolver: fixtureResolver, limiter: new ContactEmailRateLimiter() }),
    (err) => err instanceof ContactEmailError && err.code === "VALIDATION_FAILED",
  );
  await assert.rejects(
    () => createContactEmailDiagnostic(userB.id, { websiteId: websiteA.id }, { dnsResolver: fixtureResolver, limiter: new ContactEmailRateLimiter() }),
    (err) => err instanceof ContactEmailError && err.code === "WEBSITE_NOT_FOUND",
  );
});

test("stale snapshot blocks with 422 and persists no row", async () => {
  const before = await prisma.contactEmailDiagnostic.count({ where: { userId: userA.id } });
  // Age the snapshot by replacing it with an old-receivedAt row.
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: connectionA.id } });
  await prisma.connectorDiagnosticSnapshot.create({
    data: { connectionId: connectionA.id, websiteId: websiteA.id, schemaVersion: 5, payload: v5Payload(), receivedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
  });
  await assert.rejects(
    () => createContactEmailDiagnostic(userA.id, { websiteId: websiteA.id }, { dnsResolver: fixtureResolver, limiter: new ContactEmailRateLimiter() }),
    (err) => err instanceof ContactEmailError && err.code === "SNAPSHOT_STALE",
  );
  const after = await prisma.contactEmailDiagnostic.count({ where: { userId: userA.id } });
  assert.equal(after, before);
  // Restore a fresh snapshot for later tests.
  await prisma.connectorDiagnosticSnapshot.deleteMany({ where: { connectionId: connectionA.id } });
  await prisma.connectorDiagnosticSnapshot.create({ data: { connectionId: connectionA.id, websiteId: websiteA.id, schemaVersion: 5, payload: v5Payload() } });
});

test("own list/read only; cross-user read returns null", async () => {
  const list = await listContactEmailDiagnostics(userA.id, { page: 1, pageSize: 20 });
  assert.ok(list.total >= 2);
  assert.ok(list.diagnostics.every((d) => d.id));
  const mine = list.diagnostics[0];
  const found = await getContactEmailDiagnostic(userA.id, mine.id);
  assert.ok(found);
  const foreign = await getContactEmailDiagnostic(userB.id, mine.id);
  assert.equal(foreign, null);
});

test("AI: mock analysis saves, unknown reference rejected, AI never overwrites findings", async () => {
  const list = await listContactEmailDiagnostics(userA.id, { page: 1, pageSize: 20 });
  const diagnostic = await getContactEmailDiagnostic(userA.id, list.diagnostics[0].id);
  const findingId = diagnostic.findings[0].id;
  const good = await generateContactEmailAiAnalysis({
    diagnostic, findings: diagnostic.findings, userId: userA.id,
    providerOverride: new MockProvider({ analysis: ceAnalysis(findingId), messagesBuilder: buildContactEmailAiMessages }),
    limiter: new AiRateLimiter(),
  });
  assert.equal(good.status, "COMPLETED");
  assert.equal(good.analysis.summary, "SPF is present and DMARC is monitoring only.");
  await assert.rejects(
    () => generateContactEmailAiAnalysis({
      diagnostic, findings: diagnostic.findings, userId: userA.id, regenerate: true,
      providerOverride: new MockProvider({ analysis: ceAnalysis("unknown-id"), messagesBuilder: buildContactEmailAiMessages }),
      limiter: new AiRateLimiter(),
    }),
    (err) => err.code === "INVALID_OUTPUT",
  );
  const after = await prisma.contactEmailDiagnostic.findUnique({ where: { id: diagnostic.id }, include: { findings: true } });
  assert.equal(after.findings.length, diagnostic.findings.length, "AI must not change deterministic findings");
});
