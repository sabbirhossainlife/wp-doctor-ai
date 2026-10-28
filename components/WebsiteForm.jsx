"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field =
  "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200";

export default function WebsiteForm({ initial, websiteId, onDone }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.normalizedUrl ?? "");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setErrors({});
    setFormError("");
    setSubmitting(true);
    const res = await fetch(
      websiteId ? `/api/websites/${websiteId}` : "/api/websites",
      {
        method: websiteId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      }
    );
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      if (data.errors) setErrors(data.errors);
      else setFormError(data.error || "Could not save this website.");
      return;
    }
    router.refresh();
    if (onDone) onDone(data.website);
    else router.push("/dashboard");
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div>
        <label className="text-sm font-medium" htmlFor="site-name">Website name</label>
        <input id="site-name" className={field} value={name} onChange={(e) => setName(e.target.value)} required />
        {errors.name && <p className="mt-1 text-sm text-red-700" role="alert">{errors.name}</p>}
      </div>
      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="site-url">Website URL</label>
        <input id="site-url" className={field} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" required />
        <p className="mt-1 text-sm text-slate-500">http:// or https:// only. Registering a website does not scan it — use the Website Error Checker to run a diagnostic.</p>
        {errors.url && <p className="mt-1 text-sm text-red-700" role="alert">{errors.url}</p>}
      </div>
      {formError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{formError}</p>}
      <button type="submit" disabled={submitting} className="mt-6 rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50">
        {submitting ? "Saving…" : websiteId ? "Save changes" : "Add website"}
      </button>
    </form>
  );
}
