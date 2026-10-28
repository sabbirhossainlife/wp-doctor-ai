"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field =
  "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200";

const SYMPTOM_OPTIONS = [
  ["ELEMENTOR_EDITOR_NOT_LOADING", "Elementor editor not loading"],
  ["ELEMENTOR_EDITOR_WHITE_SCREEN", "Editor white screen"],
  ["ELEMENTOR_EDITOR_GRAY_SCREEN", "Editor gray screen"],
  ["ELEMENTOR_EDITOR_STUCK_LOADING", "Editor stuck loading"],
  ["ELEMENTOR_PREVIEW_NOT_LOADING", "Preview not loading"],
  ["ELEMENTOR_WIDGET_PANEL_NOT_LOADING", "Widget panel not loading"],
  ["ELEMENTOR_JAVASCRIPT_ERROR", "JavaScript error in the editor"],
  ["ELEMENTOR_CSS_OR_ASSET_ISSUE", "CSS or asset issue"],
  ["FRONTEND_LAYOUT_BROKEN", "Frontend layout broken"],
  ["MOBILE_LAYOUT_ISSUE", "Mobile layout issue"],
  ["ELEMENTOR_FREE_PRO_COMPATIBILITY", "Elementor Free / Pro compatibility question"],
  ["PHP_OR_ENVIRONMENT_REQUIREMENT", "PHP or environment requirement question"],
  ["WORDPRESS_URL_CONFIGURATION", "WordPress URL configuration question"],
  ["ISSUE_AFTER_UPDATE", "Problem appeared after an update"],
  ["OTHER_OR_UNKNOWN", "Other / not sure"],
];

// websites: [{ id, name, normalizedUrl, connectionStatus, snapshotStatus,
// snapshotReceivedAt }] — server-computed, no secrets. The form reviews the
// stored snapshot before running: a stale/missing snapshot blocks the run
// with re-sync instructions instead of running on old data. This tool is
// read-only and diagnostic only: it never deactivates plugins, switches
// themes, renders pages, or analyses screenshots. Visual diagnosis is based
// on user-reported symptoms + technical evidence, not image analysis —
// screenshot upload is intentionally not offered.
export default function ElementorCheckerForm({ websites }) {
  const router = useRouter();
  const [websiteId, setWebsiteId] = useState(websites[0]?.id ?? "");
  const [category, setCategory] = useState("OTHER_OR_UNKNOWN");
  const [description, setDescription] = useState("");
  const [affectedScope, setAffectedScope] = useState("unknown");
  const [affectedPages, setAffectedPages] = useState("unknown");
  const [deviceScope, setDeviceScope] = useState("unknown");
  const [updatePreceded, setUpdatePreceded] = useState("unknown");
  const [startedAt, setStartedAt] = useState("");
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
      const res = await fetch(`/api/elementor-diagnostics/snapshot?websiteId=${encodeURIComponent(id)}`);
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
      const res = await fetch("/api/elementor-diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteId,
          symptomCategory: category,
          symptomDescription: description,
          affectedScope,
          affectedPages,
          deviceScope,
          updatePreceded: updatePreceded === "unknown" ? null : updatePreceded === "true",
          startedAt: startedAt || null,
          errorExcerpt: excerpt || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 422) {
        setError(`${data.error || "The snapshot is not usable."} ${data.resyncInstructions || ""}`);
        return;
      }
      if (res.status === 429) {
        setError(data.error || "Too many Elementor diagnostics. Please try again later.");
        return;
      }
      if (!res.ok) {
        if (data.errors) setFieldErrors(data.errors);
        else setError(data.error || "Could not complete the Elementor diagnostic.");
        return;
      }
      router.push(`/tools/elementor-layout-checker/${data.diagnostic.id}`);
    } catch {
      setError("Could not complete the Elementor diagnostic. Check your connection and try again.");
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

  const el = snapshot?.snapshot?.elementor ?? null;
  const env = snapshot?.snapshot?.environment ?? null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <div>
        <label className="text-sm font-medium" htmlFor="el-website">Step 1 — Website</label>
        <select
          id="el-website"
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
            <p>Snapshot schema v{snapshot.snapshot.schemaVersion} · WordPress {snapshot.snapshot.wordpressVersion ?? "unknown"} · PHP {snapshot.snapshot.phpVersion ?? "unknown"}</p>
            {el ? (
              <>
                <p className="mt-1">Elementor: {el.status} {el.version ? `(version ${el.version})` : "(version unknown)"}</p>
                <p className="mt-1">
                  Elementor Pro: {el.pro ? `${el.pro.installed ? (el.pro.active ? "active" : "installed, inactive") : "not installed"}${el.pro.version ? ` (version ${el.pro.version})` : " (version unknown)"}` : "unknown"}
                </p>
              </>
            ) : (
              <p className="mt-1">Elementor data: not present in this snapshot (schema predates Tool 04). Update the connector plugin to 1.3.0+ and re-sync for a full check — an older snapshot is never labelled as “Elementor missing”.</p>
            )}
            {env && (
              <p className="mt-1">
                Configured limits — WP memory: {env.wpMemoryLimit ?? "unavailable"} · PHP memory: {env.phpMemoryLimit ?? "unavailable"} · Max execution time: {env.maxExecutionTime ?? "unavailable"} (configured values, not observed usage)
              </p>
            )}
            <p className="mt-1 text-slate-500">Snapshot status: {snapshot.snapshotStatus}. This preview shows configuration only — no screenshots, console output, logs, or page content are ever shown.</p>
          </div>
        )}
      </div>

      <div className="mt-5">
        <label className="text-sm font-medium" htmlFor="el-category">Step 3 — What is happening?</label>
        <select id="el-category" className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
          {SYMPTOM_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="mt-5">
        <label className="text-sm font-medium" htmlFor="el-description">Describe the symptom</label>
        <textarea
          id="el-description"
          className={field}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happens in the editor or on the frontend, and on which page?"
        />
        {fieldErrors.symptomDescription && <p role="alert" className="mt-1 text-sm text-red-700">{fieldErrors.symptomDescription}</p>}
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="text-sm font-medium" htmlFor="el-scope">Where does it happen?</label>
          <select id="el-scope" className={field} value={affectedScope} onChange={(e) => setAffectedScope(e.target.value)}>
            <option value="unknown">Not sure</option>
            <option value="editor">Editor only</option>
            <option value="frontend">Frontend only</option>
            <option value="both">Editor and frontend</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="el-pages">How many pages?</label>
          <select id="el-pages" className={field} value={affectedPages} onChange={(e) => setAffectedPages(e.target.value)}>
            <option value="unknown">Not sure</option>
            <option value="one">One page</option>
            <option value="many">Many pages</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="el-device">Which device?</label>
          <select id="el-device" className={field} value={deviceScope} onChange={(e) => setDeviceScope(e.target.value)}>
            <option value="unknown">Not sure</option>
            <option value="mobile">Mobile only</option>
            <option value="desktop">Desktop only</option>
            <option value="both">Mobile and desktop</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="el-update">Did it follow an update?</label>
          <select id="el-update" className={field} value={updatePreceded} onChange={(e) => setUpdatePreceded(e.target.value)}>
            <option value="unknown">Not sure</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
      </div>

      <div className="mt-5">
        <label className="text-sm font-medium" htmlFor="el-started">When did it start? (optional)</label>
        <input id="el-started" className={field} type="text" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} placeholder="e.g. after the 12 Oct update" />
      </div>

      <div className="mt-5">
        <label className="text-sm font-medium" htmlFor="el-excerpt">Error message (optional, redacted excerpt)</label>
        <textarea
          id="el-excerpt"
          className={field}
          rows={3}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="Paste only the customer-facing or editor error message."
        />
        <p className="mt-1 text-sm text-amber-800">
          Warning: never paste passwords, API keys, secrets, customer emails,
          or full addresses here. The excerpt is treated as untrusted text,
          its content is never treated as verified console evidence, and
          obvious secret patterns are redacted before storage. Do not upload
          screenshots: this tool does not analyse images, and visual diagnosis
          is based on your symptom description plus technical evidence only.
        </p>
        {fieldErrors.errorExcerpt && <p role="alert" className="mt-1 text-sm text-red-700">{fieldErrors.errorExcerpt}</p>}
      </div>

      <p className="mt-5 text-sm text-slate-600">
        The live site is not modified: nothing is deactivated, switched,
        or repaired by this app. Safe Mode, when suggested, is an editor
        troubleshooting view for an authorized admin — never a guaranteed
        fix and never a fix for live-page layout. Safe next steps are
        described for you to perform manually, on staging first.
      </p>

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={running}
        className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {running ? "Checking…" : "Run Elementor & layout check"}
      </button>
    </form>
  );
}
