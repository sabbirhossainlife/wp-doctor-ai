"use client";

import { useState } from "react";
import PageContainer from "./PageContainer";
import LogoutButton from "./LogoutButton";
import ToolsDropdown from "./ToolsDropdown";
import MobileNavigationDrawer from "./MobileNavigationDrawer";
import { useSession } from "../lib/auth-client";

// Single-row header. Desktop (lg and up): brand + Home/Dashboard + one
// Tools dropdown + account actions. Below lg the desktop nav is replaced
// by a compact brand + hamburger drawer, switching before nav can overflow.
// The 12 tool links are never rendered as a horizontal row.
export default function SiteHeader() {
  const { data: session, isPending } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur-sm">
      <PageContainer>
        <nav className="flex min-w-0 items-center justify-between gap-2 py-3" aria-label="Primary">
          <a
            href="/"
            className="min-w-0 shrink-0 whitespace-nowrap rounded text-base font-bold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            WP Doctor AI
          </a>
          <div className="hidden min-w-0 items-center gap-1 lg:flex">
            <a
              href="/"
              className="flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-200 hover:bg-slate-100 hover:text-ink"
            >
              Home
            </a>
            {!isPending && session ? (
              <a
                href="/dashboard"
                className="flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-200 hover:bg-slate-100 hover:text-ink"
              >
                Dashboard
              </a>
            ) : null}
            <ToolsDropdown />
          </div>
          <div className="hidden min-w-0 items-center gap-2 lg:flex" aria-label="Account">
            {isPending ? null : session ? (
              <LogoutButton className="flex min-h-[44px] items-center rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-slate-100" />
            ) : (
              <>
                <a
                  href="/login"
                  className="flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-200 hover:bg-slate-100 hover:text-ink"
                >
                  Log in
                </a>
                <a
                  href="/register"
                  className="flex min-h-[44px] items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-hover"
                >
                  Register
                </a>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            aria-label="Open menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl text-ink hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
          >
            ☰
          </button>
        </nav>
      </PageContainer>
      <MobileNavigationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        session={isPending ? null : session}
      />
    </header>
  );
}
