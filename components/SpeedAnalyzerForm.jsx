"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tool 05 submission form. Duplicate-submit prevention: the button is
// disabled while a run is in flight, and the server also returns the
// recent identical report instead of re-running providers. No progress
// percentage is shown (the run is one synchronous request); the state is
// honestly "running" until the server responds.
export default function SpeedAnalyzerForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [strategy, setStrategy] = useState("MOBILE");
  const [consent, setConsent] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (running || !consent) return;
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/speed-diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, strategy }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) setError("Too many speed checks. Please try again later (limit: 20 per hour).");
        else if (res.status === 400) setError(data?.errors?.url || data?.errors?.strategy || "That URL or strategy is not valid.");
        else setError(data?.error || "The speed check could not run.");
        return;
      }
      router.push(`/tools/website-speed-analyzer/${data.diagnostic.id}`);
    } catch {
      setError("The speed check could not run. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="speed-url" className="block text-sm font-medium text-slate-700">Page URL</label>
        <input
          id="speed-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          required
        />
        <p className="mt-1 text-xs text-slate-500">
          Only http/https URLs on standard ports are accepted. Private, loopback, and
          internal addresses are blocked, and URLs with embedded credentials are rejected.
        </p>
      </div>
      <div>
        <label htmlFor="speed-strategy" className="block text-sm font-medium text-slate-700">Strategy</label>
        <select
          id="speed-strategy"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        >
          <option value="MOBILE">Mobile (lab: mobile, field: phone)</option>
          <option value="DESKTOP">Desktop (lab: desktop, field: desktop)</option>
        </select>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>
          I understand this sends the page URL to Google&apos;s PageSpeed Insights and
          Chrome UX Report services for analysis (Google fetches the page from its own
          infrastructure). Query strings are always stripped before the URL is sent or
          stored, and fragments are never sent. No login, cookie, or credential is ever sent.
        </span>
      </label>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={running || !consent}
        className="rounded-lg bg-blue-700 px-5 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? "Running speed check…" : "Run speed check"}
      </button>
      <p className="text-xs text-slate-500">
        Status while running: running. When finished you will see completed, partial
        (some providers unavailable), failed, or blocked — the real outcome, not an estimate.
      </p>
    </form>
  );
}
