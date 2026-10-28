// IP destination policy: fail closed. An address is "public" only when it
// parses cleanly AND is not in any prohibited range AND (for IPv6) lies in
// the global unicast space 2000::/3. Anything uncertain is prohibited.
// No new dependency: classification uses node:net plus BigInt range checks.
import net from "node:net";

function parseIPv4(address) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = [];
  for (const part of parts) {
    // Reject empty parts, non-digits, and leading zeros (octal ambiguity).
    if (!/^(0|[1-9][0-9]*)$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return (
    ((nums[0] << 24) >>> 0) +
    ((nums[1] << 16) >>> 0) +
    ((nums[2] << 8) >>> 0) +
    nums[3]
  ) >>> 0;
}

// [base, prefix, category] — IPv4, compared as unsigned 32-bit integers.
const IPV4_PROHIBITED = [
  ["0.0.0.0", 8, "unspecified"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "carrier-grade-nat"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "ietf-protocol-assignments"],
  ["192.0.2.0", 24, "documentation"],
  ["192.88.99.0", 24, "deprecated-6to4-relay"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "documentation"],
  ["203.0.113.0", 24, "documentation"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
].map(([base, prefix, category]) => ({
  base: parseIPv4(base),
  prefix,
  category,
}));

function ipv4InRange(value, base, prefix) {
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function classifyIPv4(address) {
  const value = parseIPv4(address);
  if (value === null) return { isPublic: false, category: "invalid" };
  for (const range of IPV4_PROHIBITED) {
    if (ipv4InRange(value, range.base, range.prefix)) {
      return { isPublic: false, category: range.category };
    }
  }
  return { isPublic: true, category: "global" };
}

// --- IPv6 ---

function parseHextet(part) {
  if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
  return parseInt(part, 16);
}

function expandIPv6(address) {
  let input = address;
  // Embedded IPv4 tail, e.g. ::ffff:192.0.2.1 -> two hextets.
  const lastColon = input.lastIndexOf(":");
  const tail = input.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    input =
      input.slice(0, lastColon + 1) +
      ((v4 >>> 16) & 0xffff).toString(16) +
      ":" +
      (v4 & 0xffff).toString(16);
  }
  let groups;
  if (input.includes("::")) {
    if (input.indexOf("::") !== input.lastIndexOf("::")) return null;
    const [left, right] = input.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const leftNums = leftParts.map(parseHextet);
    const rightNums = rightParts.map(parseHextet);
    if (leftNums.includes(null) || rightNums.includes(null)) return null;
    const missing = 8 - leftNums.length - rightNums.length;
    // "::" must actually compress at least one group.
    if (missing < 1) return null;
    groups = [...leftNums, ...Array(missing).fill(0), ...rightNums];
  } else {
    const parts = input.split(":");
    if (parts.length !== 8) return null;
    groups = parts.map(parseHextet);
    if (groups.includes(null)) return null;
  }
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

function ipv6InRange(value, base, prefix) {
  if (prefix === 0) return true;
  const shift = 128n - BigInt(prefix);
  return (value >> shift) === (base >> shift);
}

// [base string, prefix, category]. Bases are parsed lazily once at load.
const IPV6_PROHIBITED = [
  ["::", 128, "unspecified"],
  ["::1", 128, "loopback"],
  ["100::", 64, "discard-only"],
  ["2001::", 32, "teredo"],
  ["2001:2::", 48, "benchmarking"],
  ["2001:10::", 28, "orchid-deprecated"],
  ["2001:20::", 28, "orchid-v2"],
  ["2001:db8::", 32, "documentation"],
  ["2002::", 16, "6to4-deprecated"],
  ["3fff::", 20, "documentation"],
  ["fc00::", 7, "unique-local"],
  ["fe80::", 10, "link-local"],
  ["ff00::", 8, "multicast"],
].map(([base, prefix, category]) => ({
  base: expandIPv6(base),
  prefix,
  category,
}));

// Global unicast space: 2000::/3 (covers 2000:: through 3fff:ffff:...).
const GLOBAL_UNICAST_BASE = expandIPv6("2000::");

function classifyIPv6(address) {
  const value = expandIPv6(address);
  if (value === null) return { isPublic: false, category: "invalid" };
  // IPv4-mapped ::ffff:a.b.c.d — judge the embedded IPv4 address.
  if (ipv6InRange(value, expandIPv6("::ffff:0:0"), 96)) {
    const embedded = Number(value & 0xffffffffn);
    const dotted = [
      (embedded >>> 24) & 0xff,
      (embedded >>> 16) & 0xff,
      (embedded >>> 8) & 0xff,
      embedded & 0xff,
    ].join(".");
    const inner = classifyIPv4(dotted);
    return inner.isPublic
      ? { isPublic: true, category: "global-via-ipv4-mapped" }
      : { isPublic: false, category: `ipv4-mapped-${inner.category}` };
  }
  // NAT64 well-known prefix 64:ff9b::/96 — judge the embedded IPv4 address.
  if (ipv6InRange(value, expandIPv6("64:ff9b::"), 96)) {
    const embedded = Number(value & 0xffffffffn);
    const dotted = [
      (embedded >>> 24) & 0xff,
      (embedded >>> 16) & 0xff,
      (embedded >>> 8) & 0xff,
      embedded & 0xff,
    ].join(".");
    const inner = classifyIPv4(dotted);
    return inner.isPublic
      ? { isPublic: true, category: "global-via-nat64" }
      : { isPublic: false, category: `nat64-${inner.category}` };
  }
  for (const range of IPV6_PROHIBITED) {
    if (ipv6InRange(value, range.base, range.prefix)) {
      return { isPublic: false, category: range.category };
    }
  }
  // Fail closed: only 2000::/3 counts as global unicast.
  if (!ipv6InRange(value, GLOBAL_UNICAST_BASE, 3)) {
    return { isPublic: false, category: "non-global" };
  }
  return { isPublic: true, category: "global" };
}

export function classifyAddress(address) {
  if (typeof address !== "string" || address.length === 0) {
    return { address, family: 0, isPublic: false, category: "invalid" };
  }
  const family = net.isIP(address);
  if (family === 4) {
    return { address, family, ...classifyIPv4(address) };
  }
  if (family === 6) {
    return { address, family, ...classifyIPv6(address) };
  }
  return { address, family: 0, isPublic: false, category: "invalid" };
}

export function isPublicAddress(address) {
  return classifyAddress(address).isPublic;
}
