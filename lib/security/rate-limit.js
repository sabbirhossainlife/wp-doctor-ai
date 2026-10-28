// Per-user in-memory rate limiter for security diagnostics.
// Same shape and limitation as Tools 02-07: single-process only; a shared
// store is the production replacement. Blocked runs still count.
export class SecurityRateLimiter {
  constructor({ limitPerHour = 20, windowMs = 60 * 60 * 1000 } = {}) {
    this.limitPerHour = limitPerHour;
    this.windowMs = windowMs;
    this.counts = new Map();
  }

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

export const sharedSecurityLimiter = new SecurityRateLimiter();
