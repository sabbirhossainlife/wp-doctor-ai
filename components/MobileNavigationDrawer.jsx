"use client";

import { useEffect, useRef } from "react";
import { TOOL_CATEGORIES } from "../lib/tools-nav";
import LogoutButton from "./LogoutButton";

// Mobile drawer (below the lg breakpoint): grouped tools, large touch
// targets (min 44px), Escape closes, focus moves in on open and returns
// to the trigger on close, and background scrolling is prevented.
export default function MobileNavigationDrawer({ open, onClose, session }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-slate-900/50"
      />
      <div
        ref={panelRef}
        className="absolute right-0 top-0 flex h-full w-[min(22rem,92vw)] flex-col overflow-y-auto bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="whitespace-nowrap text-base font-bold text-ink">WP Doctor AI</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-xl text-ink-secondary hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ×
          </button>
        </div>
        <nav aria-label="Mobile" className="min-w-0 flex-1 px-2 py-3">
          <ul className="space-y-1">
            <li>
              <a
                href="/"
                onClick={onClose}
                className="flex min-h-[44px] items-center rounded-lg px-3 py-2 text-base font-medium text-ink hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Home
              </a>
            </li>
            {session ? (
              <li>
                <a
                  href="/dashboard"
                  onClick={onClose}
                  className="flex min-h-[44px] items-center rounded-lg px-3 py-2 text-base font-medium text-ink hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Dashboard
                </a>
              </li>
            ) : null}
          </ul>
          {TOOL_CATEGORIES.map((category) => (
            <section key={category.id} aria-labelledby={`drawer-${category.id}`} className="mt-4 min-w-0">
              <h2
                id={`drawer-${category.id}`}
                className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-secondary"
              >
                {category.label}
              </h2>
              <ul className="space-y-1">
                {category.tools.map((tool) => (
                  <li key={tool.href} className="min-w-0">
                    <a
                      href={tool.href}
                      onClick={onClose}
                      className="flex min-h-[44px] flex-col justify-center rounded-lg px-3 py-2 text-base font-medium text-ink hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className="break-words">{tool.short}</span>
                      {tool.status !== "ready" ? (
                        <span className="text-xs font-normal text-amber-800">{tool.statusLabel}</span>
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <div className="border-t border-border p-4">
          {session ? (
            <LogoutButton className="flex min-h-[44px] w-full items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium" />
          ) : (
            <div className="flex gap-2">
              <a
                href="/login"
                onClick={onClose}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium"
              >
                Log in
              </a>
              <a
                href="/register"
                onClick={onClose}
                className="flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
              >
                Register
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
