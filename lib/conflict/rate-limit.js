// Per-user in-memory rate limiter for conflict diagnostics (Milestone 6).
// Single-process only (same documented limitation as the scan/AI limiters):
// suitable for development and single-instance deployment, NOT safe across
// multiple instances. A shared store behind the same interface is the
// production replacement.

export class ConflictRateLimiter {
  constructor({ limitPerHour = 20, windowMs = 60 * 60 * 1000 } = {}) {
    this.limitPerHour = limitPerHour;
    this.windowMs = windowMs;
    this.counts = new Map(); // userId -> { resetAt, count }
  }

  // Returns true when the attempt is allowed (and counts it), false when
  // the user is over quota. Blocked snapshot runs still count as attempts:
  // the limit guards the endpoint, not only successful diagnostics.
  check(userId, nowMs = Date.now()) {
    const entry = this.counts.get(userId);
    if (!entry || entry.resetAt <= nowMs) {
      this.counts.set(userId, { resetAt: nowMs + this.windowMs, count: 1 });
      return true;
    }
    if (entry.count >= this.limitPerHour) return false;
    entry.count += 1;
    return true;
  }
}

export const sharedConflictLimiter = new ConflictRateLimiter();
