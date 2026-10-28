"use client";

import { useEffect, useRef, useState } from "react";
import { TOOL_CATEGORIES } from "../lib/tools-nav";

// Desktop "Tools" mega-menu: one compact entry point for all 12 tools,
// grouped by category. Accessible: aria-expanded / aria-haspopup, Escape
// closes and returns focus to the button, ArrowDown moves focus into the
// panel, and selecting a link closes the menu.
export default function ToolsDropdown() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);

  function onButtonKeyDown(event) {
    if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => {
        panelRef.current?.querySelector("a")?.focus();
      });
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="tools-menu"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKeyDown}
        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-secondary transition-colors duration-200 hover:bg-slate-100 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Tools
        <span aria-hidden="true" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          id="tools-menu"
          role="menu"
          aria-label="Diagnostic tools"
          className="absolute left-0 top-full z-50 mt-2 max-h-[80vh] w-[min(38rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-lg"
        >
          <div className="grid gap-1 sm:grid-cols-2">
            {TOOL_CATEGORIES.map((category) => (
              <div key={category.id} className="min-w-0 rounded-lg p-1">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                  {category.label}
                </p>
                <ul className="space-y-0.5">
                  {category.tools.map((tool) => (
                    <li key={tool.href} className="min-w-0">
                      <a
                        role="menuitem"
                        href={tool.href}
                        onClick={() => setOpen(false)}
                        className="block min-h-[44px] rounded-lg px-3 py-2 text-sm font-medium text-ink transition-colors duration-200 hover:bg-accent-soft hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <span className="block break-words">{tool.short}</span>
                        {tool.status !== "ready" ? (
                          <span className="mt-0.5 block text-xs font-normal text-amber-800">
                            {tool.statusLabel}
                          </span>
                        ) : null}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
