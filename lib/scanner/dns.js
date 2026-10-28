// DNS resolution + validation. Every answer is classified; ANY prohibited
// answer rejects the hostname (mixed public+private is NOT "mostly safe").
// The validated address set is returned so the transport can pin to one of
// them — the scanner never lets the HTTP client re-resolve independently.
// Production resolver: node:dns promises. Tests inject a fake resolver with
// the same { resolve4(host), resolve6(host) } shape.
import dns from "node:dns";
import net from "node:net";
import { ScannerError } from "./errors.js";
import { classifyAddress } from "./ip-policy.js";

export const DEFAULT_DNS_TIMEOUT_MS = 5000;

export function defaultResolver() {
  return {
    resolve4: (host) => dns.promises.resolve4(host),
    resolve6: (host) => dns.promises.resolve6(host),
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`DNS timeout: ${label}`);
      error.code = "DNS_TIMEOUT";
      reject(error);
    }, ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Resolve + validate a target. Returns { addresses, chosen } where chosen is
// the single address the transport must connect to (first public IPv4, else
// first public IPv6 — deterministic, no fallback to any other answer).
export async function resolveAndValidate(target, options = {}) {
  const resolver = options.resolver || defaultResolver();
  const timeoutMs = options.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS;
  // IP literals need no DNS and cannot be rebound.
  if (target.isIpLiteral) {
    const info = classifyAddress(target.hostname);
    if (!info.isPublic) {
      throw new ScannerError(
        "PROHIBITED_DESTINATION",
        `literal ${info.category}`,
      );
    }
    return {
      addresses: [{ address: target.hostname, family: info.family }],
      chosen: { address: target.hostname, family: info.family },
    };
  }
  const settle = async (fn) => {
    try {
      const addresses = await withTimeout(fn(), timeoutMs, target.hostname);
      return { ok: true, addresses: Array.isArray(addresses) ? addresses : [] };
    } catch (error) {
      return { ok: false, error };
    }
  };
  const [v4, v6] = await Promise.all([
    settle(() => resolver.resolve4(target.hostname)),
    settle(() => resolver.resolve6(target.hostname)),
  ]);
  const failed = [v4, v6].filter((r) => !r.ok);
  const allAddresses = [...v4.addresses || [], ...v6.addresses || []];
  if (allAddresses.length === 0) {
    if (failed.some((r) => r.error?.code === "DNS_TIMEOUT")) {
      throw new ScannerError("DNS_FAILURE", "dns timeout");
    }
    throw new ScannerError("DNS_FAILURE", "no addresses or lookup failure");
  }
  const classified = allAddresses.map((address) => ({
    address,
    family: net.isIP(address),
    ...classifyAddress(address),
  }));
  const bad = classified.find((c) => c.family === 0 || !c.isPublic);
  if (bad) {
    throw new ScannerError(
      "PROHIBITED_DESTINATION",
      `answer ${bad.category}`,
    );
  }
  const addresses = classified.map(({ address, family }) => ({ address, family }));
  const chosen =
    addresses.find((a) => a.family === 4) || addresses[0];
  return { addresses, chosen };
}
