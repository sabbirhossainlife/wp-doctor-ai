import StatusIndicator from "./StatusIndicator";

// Consistent tool card: icon initial, name, short description, honest
// status where relevant, and a clear link. Hover/focus elevation only.
export default function ToolCard({ tool }) {
  const initial = tool.short.charAt(0);
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-5 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md focus-within:ring-2 focus-within:ring-accent/40">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-lg font-bold text-accent"
        >
          {initial}
        </span>
        <h3 className="min-w-0 text-base font-semibold leading-snug text-ink">
          <a
            href={tool.href}
            className="break-words underline-offset-4 hover:text-accent hover:underline focus:outline-none"
          >
            {tool.name}
          </a>
        </h3>
      </div>
      <p className="mt-3 min-w-0 flex-1 break-words text-sm leading-relaxed text-ink-secondary">
        {tool.description}
      </p>
      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
        {tool.status && tool.status !== "ready" ? (
          <StatusIndicator status={tool.status} label={tool.statusLabel} />
        ) : null}
        <a
          href={tool.href}
          aria-label={`Open ${tool.name}`}
          className="ml-auto shrink-0 text-sm font-semibold text-accent underline-offset-4 hover:text-accent-hover hover:underline"
        >
          Open tool →
        </a>
      </div>
    </article>
  );
}
