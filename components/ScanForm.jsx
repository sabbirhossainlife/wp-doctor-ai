"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field =
  "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200";

export default function ScanForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    if (scanning) return;
    setError("");
    if (!url.trim()) {
      setError("Enter a website URL to scan.");
      return;
    }
    setScanning(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setError(data.error || "Too many scan requests. Please try again later.");
        return;
      }
      if (!res.ok) {
        setError(data.errors?.url || data.error || "Could not complete the scan.");
        return;
      }
      router.push(`/tools/error-checker/${data.scan.id}`);
    } catch {
      setError("Could not complete the scan. Check your connection and try again.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div>
        <label className="text-sm font-medium" htmlFor="scan-url">
          Website URL
        </label>
        <input
          id="scan-url"
          className={field}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          required
          aria-describedby="scan-url-help"
        />
        <p id="scan-url-help" className="mt-1 text-sm text-slate-500">
          http:// or https:// only, standard ports only. Private, local, and
          internal addresses are rejected before any connection is made.
        </p>
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={scanning}
        className="mt-6 rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {scanning ? "Scanning…" : "Scan website"}
      </button>
      {scanning && (
        <p className="mt-3 text-sm text-slate-600" role="status">
          Scanning — this usually takes a few seconds and never shows a fake
          progress percentage. Please do not submit again while this runs.
        </p>
      )}
    </form>
  );
}
