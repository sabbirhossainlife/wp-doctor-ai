// Minimal in-memory fixed-window limiter for connector endpoints.
// Single-process/dev only — same documented limitation as the M2
// scanner limiter. Production must replace the store with a shared
// one behind this same interface. Quotas are never exposed to clients.
export class ConnectorLimiter {
  constructor({ store = null } = {}) {
    this.store = store || new Map();
  }

  // Returns true if the attempt is allowed (and counted), false if the
  // key has exhausted `limit` attempts in the last `windowMs`.
  check(key, limit, windowMs) {
    const now = Date.now();
    const bucket = this.store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.store.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }

  sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.store) {
      if (bucket.resetAt <= now) this.store.delete(key);
    }
  }
}

// Shared process-wide limiters (module singletons). The pairing-intent
// limiter is per website; the diagnostics limiter is per connection.
export const intentLimiter = new ConnectorLimiter();
export const diagnosticsLimiter = new ConnectorLimiter();

export const CONNECTOR_LIMITS = Object.freeze({
  intentPerWebsitePerHour: 5,
  intentWindowMs: 60 * 60 * 1000,
  diagnosticsPerConnectionPerHour: 60,
  diagnosticsWindowMs: 60 * 60 * 1000,
  pairingMaxAttempts: 5,
  pairingExpiryMs: 10 * 60 * 1000,
  timestampWindowSeconds: 300,
  maxDiagnosticsBodyBytes: 64 * 1024,
});
