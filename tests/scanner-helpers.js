// Test-only helpers. These live in tests/ and are never imported by lib/.
// Fake resolver: map hostname -> { v4: [...], v6: [...] } or an Error to
// throw, or a function (host, callCount) for mutating/rebinding fixtures.
export function makeResolver(map) {
  const calls = [];
  const resolver = {
    calls,
    resolve4: async (host) => {
      calls.push(["v4", host]);
      return resolveFrom(map, host, "v4", calls.length);
    },
    resolve6: async (host) => {
      calls.push(["v6", host]);
      return resolveFrom(map, host, "v6", calls.length);
    },
  };
  return resolver;
}

function resolveFrom(map, host, family, callCount) {
  const entry = map[host];
  if (entry instanceof Error) throw entry;
  if (typeof entry === "function") return entry(host, family, callCount);
  if (!entry) {
    const error = new Error(`ENOTFOUND ${host}`);
    error.code = "ENOTFOUND";
    throw error;
  }
  return entry[family] || [];
}

// Fake transport: map hostname -> response or function(input, callCount).
// Records every call (including the exact IP handed to it).
export function makeTransport(map) {
  const calls = [];
  const transport = async (input) => {
    calls.push({ ...input });
    const entry = map[input.hostname];
    if (entry instanceof Error) throw entry;
    if (typeof entry === "function") return entry(input, calls.length);
    if (!entry) {
      return { status: 200, headers: {}, bodyBytes: 0, bodyTruncated: false, durationMs: 0 };
    }
    return { bodyBytes: 0, bodyTruncated: false, durationMs: 0, ...entry };
  };
  transport.calls = calls;
  return transport;
}

export const PUBLIC_V4 = "93.184.216.34"; // example.com's public range (fixture only)
export const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";
