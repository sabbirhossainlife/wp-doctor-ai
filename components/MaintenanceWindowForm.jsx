"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tool 12 one-time maintenance window form. Recurrence is not offered:
// it is not implemented, and a recurring schedule must never be guessed
// from a one-time form. Times are entered as local datetimes and sent as
// ISO strings; the server stores UTC and keeps the IANA timezone for
// display. Cancelling or deleting a window stops all suppression from it.
export default function MaintenanceWindowForm({ monitorId }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [timezone, setTimezone] = useState("Asia/Dhaka");
  const [suppressAlerts, setSuppressAlerts] = useState(true);
  const [pauseChecks, setPauseChecks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/maintenance-windows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monitorId,
          title,
          description,
          startAt: startAt ? new Date(startAt).toISOString() : "",
          endAt: endAt ? new Date(endAt).toISOString() : "",
          timezone,
          suppressAlerts,
          pauseChecks,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 400) setError(Object.values(data?.errors ?? {}).join(" ") || "Please check your input.");
        else setError(data?.error || "The window could not be created.");
        return;
      }
      router.refresh();
    } catch {
      setError("The window could not be created. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="mw-title" className="text-sm font-medium text-slate-700">Title</label>
        <input id="mw-title" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </div>
      <div>
        <label htmlFor="mw-description" className="text-sm font-medium text-slate-700">Description (optional)</label>
        <textarea id="mw-description" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="mw-start" className="text-sm font-medium text-slate-700">Start</label>
          <input id="mw-start" type="datetime-local" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="mw-end" className="text-sm font-medium text-slate-700">End</label>
          <input id="mw-end" type="datetime-local" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="mw-tz" className="text-sm font-medium text-slate-700">Timezone (IANA)</label>
          <input id="mw-tz" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={timezone} onChange={(e) => setTimezone(e.target.value)} required placeholder="Asia/Dhaka" />
        </div>
      </div>
      <p className="text-sm text-slate-500">One-time windows only, maximum 14 days. Recurring windows are not supported in this milestone.</p>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={suppressAlerts} onChange={(e) => setSuppressAlerts(e.target.checked)} />
        Suppress outage/recovery notifications during the window (check history is still recorded)
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={pauseChecks} onChange={(e) => setPauseChecks(e.target.checked)} />
        Also pause checks during the window (default off: checks keep recording)
      </label>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {saving ? "Creating…" : "Create maintenance window"}
      </button>
    </form>
  );
}
