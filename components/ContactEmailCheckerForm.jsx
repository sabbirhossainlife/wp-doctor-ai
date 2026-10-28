"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tool 07 submission form. Either a URL or one of the user's own
// registered websites (the server then uses ONLY that record's stored URL
// and latest snapshot — a client-supplied URL alongside a website choice
// is ignored server-side). Optional email domain and DKIM selector.
// No progress percentage is shown; the state is honestly "running" until
// the server responds. This tool never sends email or submits a form.
export default function ContactEmailCheckerForm({ websites = [] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [websiteId, setWebsiteId] = useState("");
  const [emailDomain, setEmailDomain] = useState("");
  const [dkimSelector, setDkimSelector] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    setError("");
    try {
      const body = websiteId
        ? { websiteId, emailDomain: emailDomain || undefined, dkimSelector: dkimSelector || undefined }
        : { url, emailDomain: emailDomain || undefined, dkimSelector: dkimSelector || undefined };
      const res = await fetch("/api/contact-email-diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) setError("Too many contact/email checks. Please try again later (limit: 20 per hour).");
        else if (res.status === 400) setError(data?.errors?.emailDomain || data?.errors?.dkimSelector || data?.errors?.url || "The input is not valid.");
        else if (res.status === 404) setError("The selected website was not found on your account.");
        else if (res.status === 422) setError(`${data?.error || "No fresh snapshot is available."} ${data?.resyncInstructions || ""}`);
        else setError(data?.error || "The contact/email check could not run.");
        return;
      }
      router.push(`/tools/contact-email-checker/${data.diagnostic.id}`);
    } catch {
      setError("The contact/email check could not run. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="ce-url" className="block text-sm font-medium text-slate-700">Site URL</label>
        <input
          id="ce-url"
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setWebsiteId(""); }}
          placeholder="https://example.com/"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          required={!websiteId}
          disabled={Boolean(websiteId)}
        />
        <p className="mt-1 text-xs text-slate-500">
          URL-only runs check public DNS only; form and mail configuration
          need a registered website with a fresh connector snapshot (below).
          Query strings and fragments are stripped before anything is stored.
        </p>
      </div>
      {websites.length > 0 ? (
        <div>
          <label htmlFor="ce-website" className="block text-sm font-medium text-slate-700">Or use one of your registered websites (recommended)</label>
          <select
            id="ce-website"
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
            When a registered website is selected, its stored URL and latest
            snapshot (fresh within 24 hours) are used; any typed URL is ignored.
            A stale or missing snapshot blocks the run with re-sync instructions
            and no report is saved for that run.
          </p>
        </div>
      ) : null}
      <div>
        <label htmlFor="ce-domain" className="block text-sm font-medium text-slate-700">Email domain (optional)</label>
        <input
          id="ce-domain"
          type="text"
          value={emailDomain}
          onChange={(e) => setEmailDomain(e.target.value)}
          placeholder="example.com"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
        <p className="mt-1 text-xs text-slate-500">
          The domain SPF, DMARC, and DKIM are checked for. If left blank, the
          site&apos;s host is used with one leading &quot;www.&quot; removed —
          only when that yields a valid multi-label public domain. Never an
          email address: enter the domain only.
        </p>
      </div>
      <div>
        <label htmlFor="ce-dkim" className="block text-sm font-medium text-slate-700">DKIM selector (optional)</label>
        <input
          id="ce-dkim"
          type="text"
          value={dkimSelector}
          onChange={(e) => setDkimSelector(e.target.value)}
          placeholder="e.g. google, default, selector1"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
        <p className="mt-1 text-xs text-slate-500">
          Only useful when you know the selector your mail provider assigned
          (it appears in the provider&apos;s DNS setup instructions). Without
          a selector, DKIM is reported as not checked — selectors are never
          guessed, and DKIM is never declared missing from an unknown selector.
        </p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={running}
        className="rounded-lg bg-blue-700 px-5 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? "Running contact/email check…" : "Run Diagnostics"}
      </button>
      <p className="text-xs text-slate-500">
        Status while running: running. When finished you will see completed or
        partial (a DNS lookup failed but other findings were kept) — the real
        outcome, not an estimate. This check is read-only: it never sends an
        email, submits a form, or changes anything on the analysed site, and
        it never verifies delivery.
      </p>
    </form>
  );
}
