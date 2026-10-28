// Tool 12 scheduler trigger authentication (Milestone 16). The tick
// endpoint accepts ONLY a server-only secret (MONITORING_TICK_SECRET),
// compared in constant time. If the secret is unset, ticking is
// honestly unavailable (503 SCHEDULER_NOT_CONFIGURED) — never open to
// ordinary browser clients, never an unlimited-check endpoint for any
// authenticated user. The secret is never returned in any response,
// never logged, and never exposed to client-side code.
import { timingSafeEqual } from "node:crypto";

export function tickSecretConfigured(env = process.env) {
  return Boolean(env.MONITORING_TICK_SECRET);
}

export function validateTickSecret(provided, env = process.env) {
  const expected = env.MONITORING_TICK_SECRET ?? "";
  if (!expected || typeof provided !== "string" || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
