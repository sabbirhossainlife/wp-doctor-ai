// Status is always colour PLUS text (never colour alone). A backend
// BLOCKED state is never rendered as green success.
const STYLES = {
  ready: "border-border bg-surface text-ink-secondary",
  running: "border-cyan-accent/40 bg-cyan-50 text-cyan-900",
  completed: "border-success/30 bg-green-50 text-green-800",
  partial: "border-warning/40 bg-amber-50 text-amber-900",
  failed: "border-error/30 bg-red-50 text-red-800",
  blocked: "border-error/30 bg-red-50 text-red-800",
  "insufficient-evidence": "border-border bg-slate-100 text-ink-secondary",
  "not-configured": "border-border bg-slate-100 text-ink-secondary",
  "not-tested": "border-border bg-slate-100 text-ink-secondary",
  "scheduler-inactive": "border-warning/40 bg-amber-50 text-amber-900",
};

const DOTS = {
  ready: "bg-cyan-accent",
  running: "bg-cyan-accent",
  completed: "bg-success",
  partial: "bg-warning",
  failed: "bg-error",
  blocked: "bg-error",
  "insufficient-evidence": "bg-slate-400",
  "not-configured": "bg-slate-400",
  "not-tested": "bg-slate-400",
  "scheduler-inactive": "bg-warning",
};

export default function StatusIndicator({ status, label, className = "" }) {
  const key = STYLES[status] ? status : "not-configured";
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${STYLES[key]} ${className}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOTS[key]}`} />
      <span className="min-w-0 break-words">{label ?? key.replaceAll("-", " ")}</span>
    </span>
  );
}
