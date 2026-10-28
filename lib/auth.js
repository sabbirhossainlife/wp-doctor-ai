import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./prisma";

// Better Auth (email + password only in Milestone 1). No social providers, no
// email verification yet: no SMTP provider is configured, so verification and
// password-reset emails are NOT sent. See README "Password reset & email".
export const auth = betterAuth({
  appName: "WP Doctor AI",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // Deliberately false until SMTP is configured and tested (later milestone).
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      // Server-controlled: input:false means client requests can never set it.
      role: { type: "string", defaultValue: "USER", input: false },
    },
  },
  // Built-in rate limiter (in-memory, per IP). Dev-suitable only: it does not
  // share state across instances, so production needs a shared store later.
  // General rule: 100 requests / 60s. Better Auth's built-in SPECIAL rule
  // (verified in the installed library source) overrides this for auth
  // abuse paths: /sign-in, /sign-up, /change-password are capped at
  // 3 requests / 10s per IP, and the in-memory counter only resets after
  // 10s without a request on that path. E2E tests space auth calls >10s
  // apart accordingly.
  rateLimit: { enabled: true, window: 60, max: 100 },
  plugins: [nextCookies()],
});
