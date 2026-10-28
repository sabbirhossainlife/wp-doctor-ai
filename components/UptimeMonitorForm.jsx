"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tool 12 monitor creation form. The monitor binds to a registered
// website selected here — the server uses ONLY that record's stored URL.
// There is no arbitrary-URL input: that is deliberate, not a missing
// field. Email notifications are offered only as a preference; the UI
// states plainly that no email provider is configured, so enabling the
// preference records EMAIL_NOT_CONFIGURED rather than sending mail.
export default function UptimeMonitorForm({ websites = [], emailConfigured = false }) {
  const router = useRouter();
  const [websiteId, setWebsiteId] = useState("");
  const [interval, setInterval] = useState(15);
  const [warningLatencyMs, setWarningLatencyMs] = useState(1000);
  const [highLatencyMs, setHighLatencyMs] = useState(3000);
  const [failureThreshold, setFailureThreshold] = useState(2);
  const [recoveryThreshold, setRecoveryThreshold] = useState(2);
  const [maintenanceDetectionEnabled, setMaintenanceDetectionEnabled] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteId,
          checkIntervalMinutes: Number(interval),
          warningLatencyMs: Number(warningLatencyMs),
          highLatencyMs: Number(highLatencyMs),
          failureThreshold: Number(failureThreshold),
          recoveryThreshold: Number(recoveryThreshold),
          maintenanceDetectionEnabled,
          notifyEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) setError("Monitor limit reached (20 per account) or too many requests. Try again later.");
        else if (res.status === 404) setError("The selected website was not found on your account.");
        else if (res.status === 400) setError(Object.values(data?.errors ?? {}).join(" ") || "Please check your input.");
        else setError(data?.error || "The monitor could not be created.");
        return;
      }
      router.push(`/tools/uptime-monitor/${data.monitor.id}`);
      router.refresh();
    } catch {
      setError("The monitor could not be created. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="uptime-website" className="text-sm font-medium text-slate-700">Registered website</label>
        <select id="uptime-website" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={websiteId} onChange={(e) => setWebsiteId(e.target.value)} required>
          <option value="">Select a website…</option>
          {websites.map((w) => (
            <option key={w.id} value={w.id}>{w.name} — {w.normalizedUrl}</option>
          ))}
        </select>
        <p className="mt-1 text-sm text-slate-500">The monitor checks exactly this registered URL. If the website URL changes later, checks block until you explicitly reconfirm the new target.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="uptime-interval" className="text-sm font-medium text-slate-700">Check interval</label>
          <select id="uptime-interval" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
            <option value={5}>Every 5 minutes</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
            <option value={60}>Every 60 minutes</option>
          </select>
        </div>
        <div>
          <label htmlFor="uptime-failure" className="text-sm font-medium text-slate-700">Failures before a downtime incident (1–5)</label>
          <input id="uptime-failure" type="number" min={1} max={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={failureThreshold} onChange={(e) => setFailureThreshold(Number(e.target.value))} />
          <p className="mt-1 text-sm text-slate-500">Default 2: one failed check alone never opens an incident.</p>
        </div>
        <div>
          <label htmlFor="uptime-warning" className="text-sm font-medium text-slate-700">Warning latency (ms)</label>
          <input id="uptime-warning" type="number" min={100} max={30000} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={warningLatencyMs} onChange={(e) => setWarningLatencyMs(Number(e.target.value))} />
        </div>
        <div>
          <label htmlFor="uptime-high" className="text-sm font-medium text-slate-700">High-latency threshold (ms)</label>
          <input id="uptime-high" type="number" min={101} max={60000} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={highLatencyMs} onChange={(e) => setHighLatencyMs(Number(e.target.value))} />
          <p className="mt-1 text-sm text-slate-500">At or above this, a successful check is reported DEGRADED.</p>
        </div>
        <div>
          <label htmlFor="uptime-recovery" className="text-sm font-medium text-slate-700">Successes before recovery (1–5)</label>
          <input id="uptime-recovery" type="number" min={1} max={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={recoveryThreshold} onChange={(e) => setRecoveryThreshold(Number(e.target.value))} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={maintenanceDetectionEnabled} onChange={(e) => setMaintenanceDetectionEnabled(e.target.checked)} />
        Detect WordPress maintenance indicators (503 + recognised maintenance page)
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
        Email alerts (currently unavailable — no email provider is configured; enabling this records EMAIL_NOT_CONFIGURED, it does not send mail)
      </label>
      {!emailConfigured && notifyEmail && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          Email delivery is not configured, so no email will be sent for this monitor. In-app notifications and history will still work.
        </p>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <button type="submit" disabled={saving || !websiteId} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {saving ? "Creating…" : "Create monitor"}
      </button>
    </form>
  );
}
