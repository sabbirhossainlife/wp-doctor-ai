// Per-user AI usage limiter (Milestone 4). In-memory, single-process only:
// suitable for development and single-instance deployment, NOT safe across
// multiple instances (a shared store behind the same interface is the
// production replacement). Counts provider call attempts (including failed
// ones) — cache hits and configuration failures do not consume quota.

import { AiProviderError } from "./providers.js";

export class AiRateLimiter {
  constructor({ limitPerDay = 10 } = {}) {
    this.limitPerDay = limitPerDay;
    this.counts = new Map(); // userId -> { day: "YYYY-MM-DD", count }
  }

  check(userId) {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.counts.get(userId);
    if (entry && entry.day !== today) this.counts.delete(userId);
    const current = this.counts.get(userId);
    if (current && current.count >= this.limitPerDay) {
      throw new AiProviderError("RATE_LIMITED", "Too many AI explanations requested. Try again tomorrow.");
    }
  }

  record(userId) {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.counts.get(userId);
    if (!entry || entry.day !== today) this.counts.set(userId, { day: today, count: 1 });
    else entry.count += 1;
  }
}

export const sharedAiRateLimiter = new AiRateLimiter();
