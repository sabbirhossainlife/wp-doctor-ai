"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tool 06 submission form. Either a URL or one of the user's own
// registered websites (the server then uses ONLY that record's stored
// URL — a client-supplied URL alongside a website choice is ignored
// server-side). No progress percentage is shown; the state is honestly
// "running" until the server responds.
export default function SslRedirectCheckerForm({ websites = [] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [websiteId, setWebsiteId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    setError("");
    try {
      const body = websiteId ? { websiteId } : { url };
      const res = await fetch("/api/ssl-redirect-diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) setError("Too many SSL checks. Please try again later (limit: 20 per hour).");
        else if (res.status === 400) setError(data?.errors?.url || "That URL is not valid.");
        else if (res.status === 404) setError("The selected website was not found on your account.");
        else setError(data?.error || "The SSL check could not run.");
        return;
      }
      router.push(`/tools/ssl-redirect-checker/${data.diagnostic.id}`);
    } catch {
      setError("The SSL check could not run. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ssl-url" className="block text-sm font-medium text-slate-700">Site URL</label>
        <input
          id="ssl-url"
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setWebsiteId(""); }}
          placeholder="https://example.com/"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          required={!websiteId}
          disabled={Boolean(websiteId)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Only http/https URLs on standard ports are accepted. Private, loopback, and
          internal addresses are blocked, and URLs with embedded credentials are rejected.
          Query strings and fragments are stripped before anything is stored.
        </p>
      </div>
      {websites.length > 0 ? (
        <div>
          <label htmlFor="ssl-website" className="block text-sm font-medium text-slate-700">Or use one of your registered websites (optional)</label>
          <select
            id="ssl-website"
            value={websiteId}
            onChange={(e) => setWebsiteId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">— type a URL above instead —</option>
            {websites.map((w) => (
              <option key={w.id} value={w.id}>{w.name} — {w.normalizedUrl}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            When a registered website is selected, its stored URL is used; any typed URL is ignored.
          </p>
        </div>
      ) : null}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={running}
        className="rounded-lg bg-blue-700 px-5 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? "Running SSL check…" : "Run SSL check"}
      </button>
      <p className="text-xs text-slate-500">
        Status while running: running. When finished you will see completed, partial
        (chain stopped early), failed, or blocked — the real outcome, not an estimate.
        This check diagnoses only; it changes nothing on the analysed site.
      </p>
    </form>
  );
}
