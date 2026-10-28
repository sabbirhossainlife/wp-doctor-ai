"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field =
  "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200";

const SYMPTOM_OPTIONS = [
  ["UPDATE_ERROR", "Error after an update"],
  ["FRONTEND_BROKEN", "Front end broken"],
  ["ADMIN_ERROR", "WordPress admin error"],
  ["EDITOR_FAILURE", "Editor failure"],
  ["FEATURE_NOT_WORKING", "A feature stopped working"],
  ["THEME_LAYOUT", "Theme / layout problem"],
  ["PHP_COMPAT_WARNING", "PHP compatibility warning"],
  ["OTHER", "Other"],
  ["UNKNOWN", "Not sure"],
];

// websites: [{ id, name, normalizedUrl, connectionStatus, snapshotStatus,
// snapshotReceivedAt }] — server-computed, no secrets. The form reviews the
// stored snapshot before running: a stale/missing snapshot blocks the run
// with re-sync instructions instead of running on old data.
export default function ConflictCheckerForm({ websites }) {
  const router = useRouter();
  const [websiteId, setWebsiteId] = useState(websites[0]?.id ?? "");
  const [category, setCategory] = useState("UNKNOWN");
  const [description, setDescription] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const selected = websites.find((w) => w.id === websiteId) ?? null;

  async function loadSnapshot(id) {
    setSnapshot(null);
    if (!id) return;
    setSnapshotLoading(true);
    try {
      const res = await fetch(`/api/conflict-diagnostics/snapshot?websiteId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSnapshot(data);
    } catch {
      // Snapshot preview is advisory; the run itself re-checks freshness.
    } finally {
      setSnapshotLoading(false);
    }
  }

  function onSelectWebsite(id) {
    setWebsiteId(id);
    setError("");
    loadSnapshot(id);
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (running) return; // duplicate-submit prevention
    setError("");
    setFieldErrors({});
    if (!websiteId) {
      setError("Choose a website first.");
      return;
    }
    if (!description.trim()) {
      setFieldErrors({ symptomDescription: "Describe the symptom." });
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/conflict-diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteId,
          symptomCategory: category,
          symptomDescription: description,
          errorExcerpt: excerpt || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 422) {
        setError(`${data.error || "The snapshot is not usable."} ${data.resyncInstructions || ""}`);
        return;
      }
      if (res.status === 429) {
        setError(data.error || "Too many conflict diagnostics. Please try again later.");
        return;
      }
      if (!res.ok) {
        if (data.errors) setFieldErrors(data.errors);
        else setError(data.error || "Could not complete the conflict diagnostic.");
        return;
      }
      router.push(`/tools/plugin-theme-checker/${data.diagnostic.id}`);
    } catch {
      setError("Could not complete the conflict diagnostic. Check your connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  if (websites.length === 0) {
    return (
      <p className="text-slate-700">
        No websites yet. Add a website from the{" "}
        <a className="font-medium text-blue-700 underline" href="/dashboard">dashboard</a>{" "}
        and pair it with the connector plugin first.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div>
        <label className="text-sm font-medium" htmlFor="conflict-website">Step 1 — Website</label>
        <select
          id="conflict-website"
          className={field}
          value={websiteId}
          onChange={(e) => onSelectWebsite(e.target.value)}
        >
          {websites.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} — {w.normalizedUrl} ({w.connectionStatus})
            </option>
          ))}
        </select>
        {selected && (
          <p className="mt-2 text-sm text-slate-600">
            Connection: {selected.connectionStatus} · Snapshot: {selected.snapshotStatus}
            {selected.snapshotReceivedAt ? ` · Synced ${new Date(selected.snapshotReceivedAt).toLocaleString()}` : ""}
          </p>
        )}
      </div>

      <div className="mt-5">
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"
          onClick={() => loadSnapshot(websiteId)}
          disabled={snapshotLoading}
        >
          {snapshotLoading ? "Loading snapshot…" : "Step 2 — Review stored snapshot"}
        </button>
        {snapshot && snapshot.snapshot && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p><strong>WordPress:</strong> {snapshot.snapshot.wordpressVersion ?? "unknown"} · <strong>PHP:</strong> {snapshot.snapshot.phpVersion ?? "unknown"}</p>
            <p><strong>Snapshot schema:</strong> v{snapshot.snapshot.schemaVersion} · <strong>Status:</strong> {snapshot.snapshotStatus}</p>
            <p><strong>Plugins in snapshot:</strong> {(snapshot.snapshot.plugins ?? snapshot.snapshot.activePlugins ?? []).length}</p>
            <p><strong>Theme:</strong> {(snapshot.snapshot.theme ?? snapshot.snapshot.activeTheme)?.name ?? "unknown"}</p>
            {snapshot.snapshotStatus !== "CURRENT" && (
              <p className="mt-2 font-medium text-amber-800">
                This snapshot is {snapshot.snapshotStatus.toLowerCase().replaceAll("_", " ")}. {snapshot.resyncInstructions}
              </p>
            )}
          </div>
        )}
        {snapshot && !snapshot.snapshot && (
          <p className="mt-3 text-sm font-medium text-amber-800">
            No usable snapshot for this website. {snapshot.resyncInstructions}
          </p>
        )}
      </div>

      <div className="mt-5">
        <label className="text-sm font-medium" htmlFor="conflict-category">Step 3 — Symptom category</label>
        <select id="conflict-category" className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
          {SYMPTOM_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="conflict-description">What is happening?</label>
        <textarea
          id="conflict-description"
          className={field}
          rows={4}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the symptom: which page or feature, what you see, and when it started."
        />
        {fieldErrors.symptomDescription && <p className="mt-1 text-sm text-red-700">{fieldErrors.symptomDescription}</p>}
        <p className="mt-1 text-sm text-slate-500">Do not paste passwords, API keys, or tokens here. Your description is stored with the report.</p>
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="conflict-excerpt">Error excerpt (optional)</label>
        <textarea
          id="conflict-excerpt"
          className={field}
          rows={3}
          maxLength={2000}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="Paste a short error message if you have one. Do not paste secrets."
        />
        {fieldErrors.errorExcerpt && <p className="mt-1 text-sm text-red-700">{fieldErrors.errorExcerpt}</p>}
        <p className="mt-1 text-sm text-slate-500">Error text is treated as untrusted user input and is never used as instructions.</p>
      </div>

      <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        Step 4 — Running this check does not modify your live site. It only
        reads the last snapshot your WordPress connector sent. No plugin is
        deactivated, no theme is switched, and no setting is changed.
      </p>

      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={running}
        className="mt-4 rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {running ? "Running check…" : "Run plugin & theme check"}
      </button>
    </form>
  );
}
