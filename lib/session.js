import { headers } from "next/headers";
import { auth } from "./auth";

// Server-side only. Every protected page and API route must use this — never
// trust client-side session state for authorization.
export async function getCurrentSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session;
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user ?? null;
}
