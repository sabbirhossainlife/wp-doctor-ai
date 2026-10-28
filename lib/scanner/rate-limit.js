// Replaceable scan rate-limit / concurrency abstraction. The default store
// is in-memory: correct for a single process (dev / single-instance), NOT
// production-safe across instances — see docs/security-scanner.md. A
// distributed store (e.g. Redis) can replace MapStore later without
// changing callers. Quotas are never exposed to other users: check() only
// returns allowed/denied for the caller.
import { ScannerError } from "./errors.js";

// Minimal store interface: get(key) -> { count, resetAt } | undefined,
// set(key, value), delete(key). MapStore is the in-memory implementation.
export class MapStore {
  constructor() {
    this.map = new Map();
  }
  get(key) {
    return this.map.get(key);
  }
  set(key, value) {
    this.map.set(key, value);
  }
  delete(key) {
    this.map.delete(key);
  }
  sweep(now = Date.now()) {
    for (const [key, value] of this.map) {
      if (value.resetAt <= now) this.map.delete(key);
    }
  }
  get size() {
    return this.map.size;
  }
}

export class ScanLimiter {
  constructor(options = {}) {
    this.perUserPerMinute = options.perUserPerMinute ?? 10;
    this.perIpPerMinute = options.perIpPerMinute ?? 30;
    this.maxConcurrent = options.maxConcurrent ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.store = options.store || new MapStore();
    this.running = 0;
    this.queue = [];
  }

  _checkBucket(key, limit, now) {
    const entry = this.store.get(key);
    if (!entry || entry.resetAt <= now) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    this.store.set(key, entry);
    return true;
  }

  // Throws RATE_LIMITED when either bucket is exhausted. Callers must not
  // call acquire() after a failed check (no slot is held then).
  check({ userId, ip } = {}) {
    const now = Date.now();
    this.store.sweep?.(now);
    if (userId && !this._checkBucket(`user:${userId}`, this.perUserPerMinute, now)) {
      throw new ScannerError("RATE_LIMITED", "per-user bucket");
    }
    if (ip && !this._checkBucket(`ip:${ip}`, this.perIpPerMinute, now)) {
      throw new ScannerError("RATE_LIMITED", "per-ip bucket");
    }
  }

  // Bounded concurrency: run fn while holding a slot; excess callers wait
  // in a FIFO queue that is drained as slots free. The queue is bounded
  // by maxQueued (default 20); beyond it, CONCURRENCY_LIMIT_REACHED.
  async run(fn, options = {}) {
    const maxQueued = options.maxQueued ?? 20;
    if (this.running >= this.maxConcurrent) {
      if (this.queue.length >= maxQueued) {
        throw new ScannerError("CONCURRENCY_LIMIT_REACHED", "queue full");
      }
      await new Promise((resolve, reject) => {
        this.queue.push({ resolve, reject });
      });
    }
    this.running += 1;
    try {
      return await fn();
    } finally {
      this.running -= 1;
      const next = this.queue.shift();
      if (next) next.resolve();
    }
  }

  // Test/observability helpers (process-local only).
  get runningCount() {
    return this.running;
  }
  get queuedCount() {
    return this.queue.length;
  }
}
