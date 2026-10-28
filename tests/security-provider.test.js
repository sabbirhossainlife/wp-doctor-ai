// Tool 08 provider adapter tests (Milestone 12). All provider behaviour is
// proven with fixtures + test doubles. Mocks prove parser/rule behaviour
// ONLY — no live provider call is claimed by this file.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWpvulnerabilityResponse, normalizeWpvulnerabilityAdvisory,
  queryWpvulnerability, matchAdvisories, providerConfig, ProviderError,
  WPVULNERABILITY_BASE,
} from "../lib/security/provider.js";

function wpvulnFixture() {
  return {
    error: 0, message: null,
    data: {
      name: "Akismet Anti-spam: Spam Protection", plugin: "akismet",
      link: "https://wordpress.org/plugins/akismet/",
      vulnerability: [
        {
          uuid: "uuid-1", name: "Akismet [akismet] < 3.1.5", description: null,
          operator: { min_version: null, min_operator: null, max_version: "3.1.5", max_operator: "lt", unfixed: "0", closed: "0" },
          source: [
            { id: "CVE-2015-9357", name: "CVE-2015-9357", link: "https://www.cve.org/CVERecord?id=CVE-2015-9357", description: "x", date: "2019-08-28" },
          ],
          impact: { cvss: { version: "3.1", score: "9.8", severity: "c" } },
        },
        {
          uuid: "uuid-2", name: "Akismet [akismet] <= 2.0", description: null,
          operator: { min_version: null, min_operator: null, max_version: "2.0", max_operator: "le", unfixed: "0", closed: "0" },
          source: [], impact: null,
        },
      ],
    },
    updated: 123,
  };
}

function fetchOk(json) {
  return async (url) => {
    assert.ok(url.startsWith(WPVULNERABILITY_BASE + "/"), "provider URL must stay on the fixed official host");
    return { status: 200, text: JSON.stringify(json) };
  };
}

test("parsing: advisories normalized, CVE/CVSS kept only when supplied, le has no fabricated fixed version", () => {
  const parsed = parseWpvulnerabilityResponse(wpvulnFixture(), { productType: "plugin", slug: "akismet" });
  assert.equal(parsed.status, "OK");
  assert.equal(parsed.advisories.length, 2);
  const [a, b] = parsed.advisories;
  assert.equal(a.cveId, "CVE-2015-9357");
  assert.equal(a.cvssScore, 9.8);
  assert.equal(a.fixedVersion, "3.1.5");
  assert.equal(a.sourceUrl, "https://www.cve.org/CVERecord?id=CVE-2015-9357");
  assert.equal(b.fixedVersion, null);
  assert.equal(b.cveId, null);
  assert.equal(b.cvssScore, null);
});

test("parsing: unknown slug (vulnerability null) is OK with zero advisories, not an error", () => {
  const parsed = parseWpvulnerabilityResponse({ error: 0, message: null, data: { name: null, plugin: "nope", link: null, vulnerability: null } }, { productType: "plugin", slug: "nope" });
  assert.equal(parsed.status, "OK");
  assert.deepEqual(parsed.advisories, []);
});

test("parsing: malformed responses are provider errors, never clean results", () => {
  for (const bad of [null, "nope", [], { error: 1, message: "err", data: null }, { error: 0, data: null }]) {
    const parsed = parseWpvulnerabilityResponse(bad, { productType: "plugin", slug: "akismet" });
    assert.equal(parsed.status, "PROVIDER_ERROR", JSON.stringify(bad));
  }
});

test("matching: plugin by canonical slug + version; name alone never matches", async () => {
  const { advisories } = await queryWpvulnerability("plugin", "akismet", { fetchFn: fetchOk(wpvulnFixture()), config: providerConfig({}) });
  const matched = matchAdvisories({ productType: "plugin", slug: "akismet", version: "3.1.4" }, advisories);
  assert.equal(matched.status, "MATCHED_ADVISORY");
  assert.equal(matched.matched.length, 1);
  const cleared = matchAdvisories({ productType: "plugin", slug: "akismet", version: "3.1.5" }, advisories);
  assert.equal(cleared.status, "NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES");
  const noSlug = matchAdvisories({ productType: "plugin", slug: null, version: "3.1.4" }, advisories);
  assert.equal(noSlug.status, "COMPONENT_IDENTITY_UNCERTAIN");
  const unknownVersion = matchAdvisories({ productType: "plugin", slug: "akismet", version: "3.1.4-beta1" }, advisories);
  assert.equal(unknownVersion.status, "COMPONENT_VERSION_UNKNOWN");
  const missingVersion = matchAdvisories({ productType: "plugin", slug: "akismet", version: null }, advisories);
  assert.equal(missingVersion.status, "COMPONENT_VERSION_UNKNOWN");
});

test("matching: core is version-specific — any returned advisory matches that version", () => {
  const advisories = [{ advisoryId: "core-uuid", operatorRaw: null }];
  assert.equal(matchAdvisories({ productType: "core", slug: null, version: "5.8.2" }, advisories).status, "MATCHED_ADVISORY");
  assert.equal(matchAdvisories({ productType: "core", slug: null, version: "5.8.2" }, []).status, "NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES");
});

test("matching: all advisories unparseable -> insufficient, never a match and never a clearance", () => {
  const advisories = [{ advisoryId: "u", operatorRaw: { min_version: null, min_operator: null, max_version: "2.0", max_operator: "ne" } }];
  assert.equal(matchAdvisories({ productType: "plugin", slug: "x", version: "1.0" }, advisories).status, "INSUFFICIENT_EVIDENCE");
});

test("transport: rate limit, auth failure, malformed JSON, outage map to provider errors, never clean", async () => {
  const config = providerConfig({});
  await assert.rejects(queryWpvulnerability("plugin", "akismet", { fetchFn: async () => ({ status: 429, text: "" }), config }), (e) => e instanceof ProviderError && e.status === "PROVIDER_RATE_LIMITED");
  await assert.rejects(queryWpvulnerability("plugin", "akismet", { fetchFn: async () => ({ status: 500, text: "err" }), config }), (e) => e instanceof ProviderError && e.status === "PROVIDER_ERROR");
  await assert.rejects(queryWpvulnerability("plugin", "akismet", { fetchFn: async () => ({ status: 200, text: "{not json" }), config }), (e) => e instanceof ProviderError && e.status === "PROVIDER_ERROR");
  await assert.rejects(queryWpvulnerability("plugin", "akismet", { fetchFn: async () => { throw new Error("boom"); }, config }), (e) => e instanceof ProviderError && e.status === "PROVIDER_ERROR");
});

test("transport: invalid slug / version never reaches the network, and no arbitrary base URL is accepted", async () => {
  let called = false;
  const config = providerConfig({});
  await assert.rejects(queryWpvulnerability("plugin", "evil slug!", { fetchFn: async () => { called = true; return { status: 200, text: "{}" }; }, config }));
  await assert.rejects(queryWpvulnerability("plugin", "https://evil.example/x", { fetchFn: async () => { called = true; return { status: 200, text: "{}" }; }, config }));
  await assert.rejects(queryWpvulnerability("plugin", "../traversal", { fetchFn: async () => { called = true; return { status: 200, text: "{}" }; }, config }));
  assert.equal(called, false);
});

test("config: provider names — wpvulnerability supported, none/wpscan handled by service, defaults bounded", () => {
  assert.equal(providerConfig({}).name, "wpvulnerability");
  assert.equal(providerConfig({ VULNERABILITY_PROVIDER: "none" }).name, "none");
  assert.equal(providerConfig({ VULNERABILITY_PROVIDER: "wpscan" }).name, "wpscan");
  assert.ok(providerConfig({}).timeoutMs > 0 && providerConfig({}).maxComponents > 0);
});

test("normalize: no field is fabricated for a minimal entry", () => {
  const a = normalizeWpvulnerabilityAdvisory({ uuid: "u1", name: "Thing <= 1.0", operator: null, source: [], impact: null }, { productType: "plugin", slug: "thing" });
  assert.equal(a.cveId, null);
  assert.equal(a.cvssScore, null);
  assert.equal(a.fixedVersion, null);
  assert.equal(a.sourceUrl, null);
  assert.equal(a.range, null);
  assert.equal(normalizeWpvulnerabilityAdvisory(null, { productType: "plugin", slug: "x" }), null);
  assert.equal(normalizeWpvulnerabilityAdvisory({ uuid: "", name: "" }, { productType: "plugin", slug: "x" }), null);
});
