"use client";

import { useState } from "react";

// Tool 10 forms. No destructive operation ever runs on mount, refresh,
// or opening a report: restore/migration only proceed after the user
// types the exact destination-host phrase and the server validates it.
// No fake progress percentage is shown anywhere — only server states.
function Field({ label, id, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
const selectCls = "w-full rounded-lg border border-slate-300 px-3 py-2";
const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2";
const btnCls = "rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

export function BackupCreateForm({ websites = [] }) {
  const [websiteId, setWebsiteId] = useState("");
  const [mode, setMode] = useState("SITE_DATA_BACKUP");
  const [ack, setAck] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(e) {
    e.preventDefault(); if (running) return; setRunning(true); setMessage("");
    try {
      const res = await fetch("/api/backup-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ websiteId, mode, acknowledgeSensitiveData: ack }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data?.error || "Backup job could not be created."); return; }
      setMessage(data.blocked
        ? `Backup job blocked: ${data.operation?.errorCode || "preflight failed"}. Check the job list below — nothing was uploaded and no site data was changed.`
        : "Backup job queued. The WordPress connector (plugin 1.7.0) must now upload the backup package from WordPress admin: it is not uploaded from this browser.");
    } catch { setMessage("Backup job could not be created."); } finally { setRunning(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Registered website" id="bk-website">
        <select id="bk-website" value={websiteId} onChange={(e) => setWebsiteId(e.target.value)} className={selectCls} required>
          <option value="">Select a registered website…</option>
          {websites.map((w) => (<option key={w.id} value={w.id}>{w.name} — {w.normalizedUrl}</option>))}
        </select>
      </Field>
      <Field label="Backup mode" id="bk-mode">
        <select id="bk-mode" value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls}>
          <option value="SITE_DATA_BACKUP">Site data backup (database + supported files)</option>
          <option value="DATABASE_ONLY">Database only</option>
          <option value="FILES_ONLY">Files only</option>
        </select>
      </Field>
      <p className="text-sm text-slate-600">Included: database tables (DB modes) and wp-content/plugins, themes, mu-plugins, uploads, languages plus core/install files (file modes). Excluded by default: wp-config.php, caches, upgrade temp dirs, files outside the WordPress root, and anything outside the documented scope. This is a site-data backup, not a complete hosting/server image.</p>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" required />
        <span>I understand a backup may contain sensitive data (user info, private content, customer data, password hashes, code, private media) and that backup contents are never shown in this dashboard.</span>
      </label>
      <button type="submit" disabled={running} className={btnCls}>{running ? "Creating backup job…" : "Create Backup Job"}</button>
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    </form>
  );
}

export function RestoreCreateForm({ websites = [], artifacts = [] }) {
  const [backupId, setBackupId] = useState("");
  const [destinationWebsiteId, setDestinationWebsiteId] = useState("");
  const [job, setJob] = useState(null);
  const [phrase, setPhrase] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  async function create(e) {
    e.preventDefault(); if (running) return; setRunning(true); setMessage("");
    try {
      const res = await fetch("/api/restore-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backupId, destinationWebsiteId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data?.error || "Restore job could not be created."); return; }
      setJob(data.operation);
      setMessage(data.blocked ? `Restore job blocked: ${data.operation?.errorCode}. No target change was made.` : "Restore dry-run plan ready. Review it below, then type the exact confirmation phrase to proceed.");
    } catch { setMessage("Restore job could not be created."); } finally { setRunning(false); }
  }
  async function confirm(e) {
    e.preventDefault(); if (running || !job) return; setRunning(true); setMessage("");
    try {
      const res = await fetch(`/api/restore-jobs/${job.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phrase }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data?.errors?.phrase || data?.error || "Confirmation failed."); return; }
      setJob(data.operation);
      setMessage("Confirmation was valid, but live restore execution is NOT implemented in Milestone 14: the job is BLOCKED and the destination was not modified. See the manual next steps on this page.");
    } catch { setMessage("Confirmation failed."); } finally { setRunning(false); }
  }
  const expected = job?.plan?.destinationHost ? `RESTORE TO ${job.plan.destinationHost}` : "";
  return (
    <div className="space-y-4">
      <form onSubmit={create} className="space-y-4">
        <Field label="Verified backup" id="rs-backup">
          <select id="rs-backup" value={backupId} onChange={(e) => setBackupId(e.target.value)} className={selectCls} required>
            <option value="">Select a verified backup…</option>
            {artifacts.map((a) => (<option key={a.id} value={a.id}>{a.id} — {a.mode} — {a.status}</option>))}
          </select>
        </Field>
        <Field label="Destination website (registered, owned)" id="rs-dest">
          <select id="rs-dest" value={destinationWebsiteId} onChange={(e) => setDestinationWebsiteId(e.target.value)} className={selectCls} required>
            <option value="">Select the destination website…</option>
            {websites.map((w) => (<option key={w.id} value={w.id}>{w.name} — {w.normalizedUrl}</option>))}
          </select>
        </Field>
        <button type="submit" disabled={running} className={btnCls}>{running ? "Preparing dry-run…" : "Prepare Restore Dry-Run"}</button>
      </form>
      {job && job.state === "AWAITING_CONFIRMATION" && (
        <form onSubmit={confirm} className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-medium text-red-800">Destructive operation — dry-run plan</p>
          <p className="text-sm text-slate-700">Destination: {job.plan?.destinationHost}. Database strategy: {job.plan?.dbStrategy}. File strategy: {job.plan?.fileStrategy}. A pre-restore rollback backup is mandatory before any future execution; none exists yet for this job, which is one reason execution is blocked in this milestone.</p>
          <p className="text-sm text-slate-700">To confirm, type exactly: <strong>{expected}</strong></p>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} className={inputCls} aria-label="Typed restore confirmation phrase" required />
          <button type="submit" disabled={running} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{running ? "Confirming…" : "Confirm Restore Plan"}</button>
        </form>
      )}
      {job && job.state !== "AWAITING_CONFIRMATION" && <p className="text-sm text-slate-700">Job state: <strong>{job.state}</strong>{job.errorCode ? ` (${job.errorCode})` : ""}</p>}
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}

export function MigrationCreateForm({ websites = [], artifacts = [] }) {
  const [sourceWebsiteId, setSourceWebsiteId] = useState("");
  const [destinationWebsiteId, setDestinationWebsiteId] = useState("");
  const [sourceBackupId, setSourceBackupId] = useState("");
  const [job, setJob] = useState(null);
  const [phrase, setPhrase] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  async function create(e) {
    e.preventDefault(); if (running) return; setRunning(true); setMessage("");
    try {
      const res = await fetch("/api/migration-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceWebsiteId, destinationWebsiteId, sourceBackupId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data?.error || "Migration job could not be created."); return; }
      setJob(data.operation);
      setMessage(data.blocked ? `Migration job blocked: ${data.operation?.errorCode}. No destination change was made and the source was never deleted.` : "Migration dry-run plan ready. Review it, then type the exact confirmation phrase.");
    } catch { setMessage("Migration job could not be created."); } finally { setRunning(false); }
  }
  async function confirm(e) {
    e.preventDefault(); if (running || !job) return; setRunning(true); setMessage("");
    try {
      const res = await fetch(`/api/migration-jobs/${job.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phrase }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data?.errors?.phrase || data?.error || "Confirmation failed."); return; }
      setJob(data.operation);
      setMessage("Confirmation was valid, but live migration execution is NOT implemented in Milestone 14: the job is BLOCKED, the destination was not modified, and the source was never deleted.");
    } catch { setMessage("Confirmation failed."); } finally { setRunning(false); }
  }
  const expected = job?.plan?.destinationHost ? `MIGRATE TO ${job.plan.destinationHost}` : "";
  return (
    <div className="space-y-4">
      <form onSubmit={create} className="space-y-4">
        <Field label="Source website" id="mg-src">
          <select id="mg-src" value={sourceWebsiteId} onChange={(e) => setSourceWebsiteId(e.target.value)} className={selectCls} required>
            <option value="">Select the source website…</option>
            {websites.map((w) => (<option key={w.id} value={w.id}>{w.name} — {w.normalizedUrl}</option>))}
          </select>
        </Field>
        <Field label="Destination website (must differ from source)" id="mg-dst">
          <select id="mg-dst" value={destinationWebsiteId} onChange={(e) => setDestinationWebsiteId(e.target.value)} className={selectCls} required>
            <option value="">Select the destination website…</option>
            {websites.map((w) => (<option key={w.id} value={w.id}>{w.name} — {w.normalizedUrl}</option>))}
          </select>
        </Field>
        <Field label="Verified source backup" id="mg-backup">
          <select id="mg-backup" value={sourceBackupId} onChange={(e) => setSourceBackupId(e.target.value)} className={selectCls} required>
            <option value="">Select the verified source backup…</option>
            {artifacts.map((a) => (<option key={a.id} value={a.id}>{a.id} — {a.mode} — {a.status}</option>))}
          </select>
        </Field>
        <button type="submit" disabled={running} className={btnCls}>{running ? "Preparing dry-run…" : "Prepare Migration Dry-Run"}</button>
      </form>
      {job && job.state === "AWAITING_CONFIRMATION" && (
        <form onSubmit={confirm} className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-medium text-red-800">Destructive operation — migration dry-run plan</p>
          <p className="text-sm text-slate-700">Source: {job.plan?.sourceHost} → destination: {job.plan?.destinationHost}. Destination wp-config.php, DB credentials, secret keys, and hosting config are never copied from the source. URL rewriting is serialization-aware for supported types only; unsupported formats are skipped and reported, never corrupted.</p>
          <p className="text-sm text-slate-700">To confirm, type exactly: <strong>{expected}</strong></p>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} className={inputCls} aria-label="Typed migration confirmation phrase" required />
          <button type="submit" disabled={running} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{running ? "Confirming…" : "Confirm Migration Plan"}</button>
        </form>
      )}
      {job && job.state !== "AWAITING_CONFIRMATION" && <p className="text-sm text-slate-700">Job state: <strong>{job.state}</strong>{job.errorCode ? ` (${job.errorCode})` : ""}</p>}
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}
