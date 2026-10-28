import test from "node:test";
import assert from "node:assert/strict";
import { resolveAndValidate } from "../lib/scanner/dns.js";
import { makeResolver, PUBLIC_V4, PUBLIC_V6 } from "./scanner-helpers.js";

const target = (hostname, isIpLiteral = false) => ({
  hostname,
  isIpLiteral,
  protocol: "https:",
  port: 443,
});

test("accepts public A and AAAA answers, prefers IPv4", async () => {
  const resolver = makeResolver({
    "example.com": { v4: [PUBLIC_V4], v6: [PUBLIC_V6] },
  });
  const result = await resolveAndValidate(target("example.com"), { resolver });
  assert.equal(result.chosen.address, PUBLIC_V4);
  assert.equal(result.chosen.family, 4);
  assert.equal(result.addresses.length, 2);
});

test("accepts IPv6-only public answer", async () => {
  const resolver = makeResolver({ "example.com": { v4: [], v6: [PUBLIC_V6] } });
  const result = await resolveAndValidate(target("example.com"), { resolver });
  assert.equal(result.chosen.address, PUBLIC_V6);
});

test("rejects mixed public+private answers", async () => {
  const resolver = makeResolver({
    "example.com": { v4: [PUBLIC_V4, "10.0.0.9"], v6: [] },
  });
  await assert.rejects(
    () => resolveAndValidate(target("example.com"), { resolver }),
    (e) => e.code === "PROHIBITED_DESTINATION",
  );
});

test("rejects all-private answers", async () => {
  const resolver = makeResolver({
    "example.com": { v4: ["192.168.0.5"], v6: ["fd00::1"] },
  });
  await assert.rejects(
    () => resolveAndValidate(target("example.com"), { resolver }),
    (e) => e.code === "PROHIBITED_DESTINATION",
  );
});

test("rejects NXDOMAIN, empty results, and resolver errors safely", async () => {
  const nx = makeResolver({ "example.com": new Error("ENOTFOUND") });
  await assert.rejects(
    () => resolveAndValidate(target("example.com"), { resolver: nx }),
    (e) => e.code === "DNS_FAILURE",
  );
  const empty = makeResolver({ "example.com": { v4: [], v6: [] } });
  await assert.rejects(
    () => resolveAndValidate(target("example.com"), { resolver: empty }),
    (e) => e.code === "DNS_FAILURE",
  );
});

test("DNS timeout fails safely", async () => {
  const hanging = {
    resolve4: () => new Promise(() => {}),
    resolve6: () => new Promise(() => {}),
  };
  await assert.rejects(
    () => resolveAndValidate(target("example.com"), { resolver: hanging, dnsTimeoutMs: 50 }),
    (e) => e.code === "DNS_FAILURE",
  );
});

test("unexpected address families are rejected", async () => {
  const weird = makeResolver({ "example.com": { v4: ["not-an-ip"], v6: [] } });
  await assert.rejects(
    () => resolveAndValidate(target("example.com"), { resolver: weird }),
    (e) => e.code === "PROHIBITED_DESTINATION",
  );
});

test("IP literals skip DNS and are classified directly", async () => {
  const neverCalled = {
    resolve4: () => { throw new Error("must not resolve literals"); },
    resolve6: () => { throw new Error("must not resolve literals"); },
  };
  const ok = await resolveAndValidate(target("8.8.8.8", true), { resolver: neverCalled });
  assert.equal(ok.chosen.address, "8.8.8.8");
  await assert.rejects(
    () => resolveAndValidate(target("127.0.0.1", true), { resolver: neverCalled }),
    (e) => e.code === "PROHIBITED_DESTINATION",
  );
  await assert.rejects(
    () => resolveAndValidate(target("169.254.169.254", true), { resolver: neverCalled }),
    (e) => e.code === "PROHIBITED_DESTINATION",
  );
});
