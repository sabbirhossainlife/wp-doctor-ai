"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tool 08 submission form. A full security scan requires one of the user's
// own registered websites: the server then uses ONLY that record's stored
// URL and latest connector snapshot. There is no URL-only full scan, and
// no client-supplied inventory, version, finding, or provider data is ever
// accepted. No progress percentage is shown; the state is honestly
// "running" until the server responds.
export default function SecurityScannerForm({ websites = [] }) {
  const router = useRouter();
  const [websiteId, setWebsiteId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/security-diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) setError("Too many security scans. Please try again later (limit: 20 per hour).");
        else if (res.status === 400) setError(data?.errors?.websiteId || "A registered website is required.");
        else if (res.status === 404) setError("The selected website was not found on your account.");
        else if (res.status === 422) setError(`${data?.error || "No fresh snapshot is available."} ${data?.resyncInstructions || ""}`);
        else setError(data?.error || "The security scan could not run.");
        return;
      }
      router.push(`/tools/security-scanner/${data.diagnostic.id}`);
    } catch {
      setError("The security scan could not run. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="sec-website" className="block text-sm font-medium text-slate-700">Registered website</label>
        <select
          id="sec-website"
          value={websiteId}
          onChange={(e) => setWebsiteId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          required
        >
          <option value="">Select a registered website…</option>
          {websites.map((w) => (
            <option key={w.id} value={w.id}>{w.name} — {w.normalizedUrl}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          The scan uses the site&apos;s latest connector snapshot (no more than 24 hours old).
          If the snapshot is stale, the run is blocked with re-sync instructions and no report is saved.
          The site must be publicly reachable for the passive HTTP checks; a loopback or private
          address cannot be probed by design.
        </p>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={running || !websiteId}
        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {running ? "Running security scan…" : "Run Security Scan"}
      </button>
    </form>
  );
}
