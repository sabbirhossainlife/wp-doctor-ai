"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tool 11 submission form. Two modes, one endpoint: a registered website
// (the server then uses ONLY that record's stored URL and fresh connector
// snapshot) or a bare URL (passive HTTP checks only; SEO-plugin evidence
// is not checked). No client-supplied inventory, version, finding, or SEO
// status is ever accepted. Shows no fake progress percentage, only an
// honest "running" state until the server responds. This tool never
// cleans, edits, deletes, or otherwise modifies anything on a site.
export default function SeoCheckerForm({ websites = [] }) {
  const router = useRouter();
  const [mode, setMode] = useState("website");
  const [websiteId, setWebsiteId] = useState("");
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    setError("");
    try {
      const body = mode === "website" ? { websiteId } : { url };
      const res = await fetch("/api/seo-diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) setError("Too many SEO checks. Please try again later (limit: 20 per hour).");
        else if (res.status === 400) setError(data?.errors?.url || data?.errors?.websiteId || "Please check your input.");
        else if (res.status === 404) setError("The selected website was not found on your account.");
        else if (res.status === 422) setError(`${data?.error || "No fresh snapshot is available."} ${data?.resyncInstructions || ""}`);
        else setError(data?.error || "The SEO check could not run.");
        return;
      }
      router.push(`/tools/seo-spam-checker/${data.diagnostic.id}`);
    } catch {
      setError("The SEO check could not run. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Check target</legend>
        <div className="mt-2 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="seo-mode" value="website" checked={mode === "website"} onChange={() => setMode("website")} />
            Registered website
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="seo-mode" value="url" checked={mode === "url"} onChange={() => setMode("url")} />
            URL only
          </label>
        </div>
      </fieldset>
      {mode === "website" ? (
        <div>
          <label htmlFor="seo-website" className="block text-sm font-medium text-slate-700">Registered website</label>
          <select
            id="seo-website"
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
            The check uses the site&apos;s latest connector snapshot (no more than 24 hours old) for SEO-plugin
            evidence. If the snapshot is stale, the run is blocked with re-sync instructions and no report is saved.
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="seo-url" className="block text-sm font-medium text-slate-700">URL</label>
          <input
            id="seo-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            URL-only runs perform passive homepage, robots.txt, and sitemap checks only. SEO-plugin evidence
            is not checked without a registered website and fresh snapshot, and loopback/private addresses are
            blocked by design.
          </p>
        </div>
      )}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={running || (mode === "website" ? !websiteId : !url)}
        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {running ? "Running SEO check…" : "Run SEO Check"}
      </button>
    </form>
  );
}
