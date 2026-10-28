"use client";

import { useSession } from "../lib/auth-client";

// Hero actions adapt to auth state: dashboard when logged in,
// register when not. While the session is loading, both links are safe
// destinations, so nothing is hidden behind a spinner.
export default function HomeHeroActions() {
  const { data: session } = useSession();
  return (
    <div className="mt-8 flex min-w-0 flex-wrap items-center gap-3">
      {session ? (
        <a
          href="/dashboard"
          className="flex min-h-[44px] items-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-hover"
        >
          Go to your dashboard
        </a>
      ) : (
        <a
          href="/register"
          className="flex min-h-[44px] items-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-hover"
        >
          Get started — create an account
        </a>
      )}
      <a
        href="#tools"
        className="flex min-h-[44px] items-center rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-slate-100"
      >
        Explore the tools
      </a>
    </div>
  );
}
