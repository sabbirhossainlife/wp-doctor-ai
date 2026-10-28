"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tool 12 monitor actions: manual check (rate-limited, lease-guarded on
// the server), pause/resume, and explicit target reconfirmation. Manual
// checks never bypass the scanner policy and never fabricate a result:
// a blocked target still returns a truthful BLOCKED check.
export default function UptimeMonitorActions({ monitor }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function call(path, method, body) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "The action could not be completed.");
        return;
      }
      setMessage("Done — the monitor detail below has been refreshed.");
      router.refresh();
    } catch {
      setMessage("The action could not be completed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy || monitor.status === "PAUSED"} onClick={() => call(`/api/monitors/${monitor.id}/run-check`, "POST")} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        Run manual check
      </button>
      {monitor.status === "PAUSED" ? (
        <button type="button" disabled={busy} onClick={() => call(`/api/monitors/${monitor.id}`, "PATCH", { paused: false })} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">
          Resume monitoring
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={() => call(`/api/monitors/${monitor.id}`, "PATCH", { paused: true })} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">
          Pause monitoring
        </button>
      )}
      {!monitor.targetConfirmed && (
        <button type="button" disabled={busy} onClick={() => call(`/api/monitors/${monitor.id}`, "PATCH", { confirmTarget: true })} className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">
          Reconfirm new target URL
        </button>
      )}
      {message && <p className="w-full text-sm text-slate-600" role="status">{message}</p>}
    </div>
  );
}
