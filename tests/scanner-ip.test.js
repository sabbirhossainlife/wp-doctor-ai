import test from "node:test";
import assert from "node:assert/strict";
import { classifyAddress, isPublicAddress } from "../lib/scanner/ip-policy.js";

const cases = [
  // [address, expectedPublic]
  ["8.8.8.8", true],
  ["93.184.216.34", true],
  ["1.1.1.1", true],
  ["192.31.196.1", true], // AS112 anycast is globally reachable
  ["127.0.0.1", false],
  ["127.53.1.2", false],
  ["0.0.0.0", false],
  ["0.1.2.3", false],
  ["10.0.0.5", false],
  ["172.16.0.1", false],
  ["172.31.255.255", false],
  ["192.168.1.1", false],
  ["169.254.169.254", false], // cloud metadata
  ["169.254.10.20", false],
  ["100.64.0.1", false], // CGNAT
  ["100.127.255.255", false],
  ["192.0.2.10", false], // documentation
  ["198.51.100.7", false],
  ["203.0.113.9", false],
  ["198.18.0.1", false], // benchmarking
  ["192.0.0.170", false], // IETF protocol assignments
  ["224.0.0.1", false], // multicast
  ["240.0.0.1", false], // reserved
  ["255.255.255.255", false],
  ["999.1.1.1", false], // invalid
  ["01.2.3.4", false], // leading zero: ambiguous, fail closed
  ["2606:4700:4700::1111", true],
  ["2a00:1450:4001:800::200e", true],
  ["::1", false],
  ["::", false],
  ["fe80::1", false],
  ["fc00::1", false],
  ["fd12:3456::1", false],
  ["ff02::1", false],
  ["2001:db8::1", false], // documentation
  ["2001:2::1", false], // benchmarking
  ["2001::1", false], // Teredo
  ["2002::1", false], // 6to4
  ["3fff::1", false], // documentation
  ["::ffff:127.0.0.1", false], // mapped loopback
  ["::ffff:10.0.0.1", false], // mapped private
  ["::ffff:169.254.169.254", false], // mapped metadata
  ["::ffff:8.8.8.8", true], // mapped public -> judged by embedded IPv4
  ["64:ff9b::10.0.0.1", false], // NAT64 to private
  ["64:ff9b::8.8.8.8", true], // NAT64 to public
  ["100::1", false], // discard-only
  ["5f00::1", false], // outside 2000::/3: fail closed
  ["not-an-ip", false],
];

for (const [address, expected] of cases) {
  test(`classify ${address} -> public=${expected}`, () => {
    assert.equal(isPublicAddress(address), expected);
    assert.equal(classifyAddress(address).isPublic, expected);
  });
}

test("categories are specific for key ranges", () => {
  assert.equal(classifyAddress("127.0.0.1").category, "loopback");
  assert.equal(classifyAddress("169.254.169.254").category, "link-local");
  assert.equal(classifyAddress("100.64.0.1").category, "carrier-grade-nat");
  assert.equal(classifyAddress("::1").category, "loopback");
  assert.equal(classifyAddress("fd00::1").category, "unique-local");
  assert.equal(classifyAddress("::ffff:10.0.0.1").category, "ipv4-mapped-private");
});
