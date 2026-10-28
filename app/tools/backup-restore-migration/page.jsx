import { redirect } from "next/navigation";
import PageContainer from "../../../components/PageContainer";
import PageHeader from "../../../components/PageHeader";
import { BackupCreateForm, RestoreCreateForm, MigrationCreateForm } from "../../../components/BackupToolForms";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";
import { storageReadiness, encryptionReadiness } from "../../../lib/backup/storage";

export default async function BackupRestoreMigrationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const websites = await prisma.website.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const artifacts = await prisma.backupArtifact.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const operations = await prisma.backupOperation.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const storage = storageReadiness();
  const encryption = encryptionReadiness();
  const simple = (list) => list.map((w) => ({ id: w.id, name: w.name, normalizedUrl: w.normalizedUrl }));
  const simpleArtifacts = artifacts.map((a) => ({ id: a.id, mode: a.mode, status: a.status }));
  return (
    <PageContainer>
      <main className="py-12">
        <PageHeader title="Backup, Restore & Migration Assistant" backHref="/dashboard" backLabel="Back to dashboard">
        <p className="mt-3 text-slate-600">
          Authenticated, user-controlled, verified — never fake success. Backups are site-data backups
          (database and/or supported files), not complete hosting/server images. Backup contents are
          never shown in this dashboard. The SaaS database is never a restore target: restores and
          migrations target only registered WordPress sites you own.
        </p>
        </PageHeader>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="bk-status-heading">
          <h2 id="bk-status-heading" className="text-lg font-semibold">Storage &amp; encryption readiness</h2>
          <p className="mt-2 text-sm text-slate-600">
            Storage: {storage.ready ? `ready (${storage.driver}, private local storage — development/test only)` : `NOT READY (${storage.reason}) — backup execution is blocked until configured.`}
            {" "}Encryption at rest: {encryption.ready ? `ready (AES-256-GCM, key id ${encryption.keyId})` : "NOT READY — backup execution is blocked until BACKUP_ENCRYPTION_KEY is set; there is no plaintext fallback."}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Backups are encrypted by the configured service before storage and transmitted over TLS;
            this is not end-to-end encryption (the service holds the key). Production use with local
            storage only is blocked: a private persistent store is required.
          </p>
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="bk-create-heading">
          <h2 id="bk-create-heading" className="text-lg font-semibold">Create a backup</h2>
          <div className="mt-4"><BackupCreateForm websites={simple(websites)} /></div>
          <p className="mt-3 text-sm text-slate-600">After the job is queued, open the connector (plugin 1.7.0) in WordPress admin and use “Create backup export” — the package uploads in bounded chunks to this service, is integrity-checked, encrypted, and stored. This page never uploads a backup from the browser.</p>
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="bk-artifacts-heading">
          <h2 id="bk-artifacts-heading" className="text-lg font-semibold">Backup history</h2>
          {artifacts.length === 0 ? <p className="mt-2 text-sm text-slate-600">No backups yet.</p> : (
            <ul className="mt-2 space-y-2">
              {artifacts.map((a) => (
                <li key={a.id} className="text-sm text-slate-700">
                  <a className="font-medium text-blue-700 underline" href={`/tools/backup-restore-migration/${a.id}`}>{a.id}</a>
                  {" "}— {a.mode} — status {a.status} — verification {a.verificationStatus}
                  {a.archiveBytes ? ` — ${a.archiveBytes} bytes` : ""} — {a.fileCount} files, {a.tableCount} tables
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="bk-restore-heading">
          <h2 id="bk-restore-heading" className="text-lg font-semibold">Restore (dry-run + confirmation)</h2>
          <div className="mt-4"><RestoreCreateForm websites={simple(websites)} artifacts={simpleArtifacts} /></div>
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="bk-mig-heading">
          <h2 id="bk-mig-heading" className="text-lg font-semibold">Migration (guided: source → destination → compare → limitations → backups → plan → URL handling → overwrite risks → confirm → execute → verify)</h2>
          <div className="mt-4"><MigrationCreateForm websites={simple(websites)} artifacts={simpleArtifacts} /></div>
          <p className="mt-3 text-sm text-slate-600">Migration never uses an arbitrary destination URL, never deletes the source, and never copies destination config/secrets from the source.</p>
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="bk-jobs-heading">
          <h2 id="bk-jobs-heading" className="text-lg font-semibold">Operation history &amp; audit</h2>
          {operations.length === 0 ? <p className="mt-2 text-sm text-slate-600">No operations yet.</p> : (
            <ul className="mt-2 space-y-2">
              {operations.map((o) => (
                <li key={o.id} className="text-sm text-slate-700">
                  {o.id} — {o.type} — state <strong>{o.state}</strong>{o.errorCode ? ` — ${o.errorCode}` : ""} — created {o.createdAt.toISOString()}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-slate-600">Job progress shows persisted states and counts only — never a fabricated percentage.</p>
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="bk-limits-heading">
          <h2 id="bk-limits-heading" className="text-lg font-semibold">What is blocked in this milestone (honest limits)</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Live restore and live migration execution: confirmed jobs end BLOCKED with no target change, because no tested connector restore-apply endpoint and no verified pre-restore rollback backup exist yet. A restore/migration is never reported COMPLETED here.</li>
            <li>Multisite backup/restore/migration: detected and refused, never a silent single-site backup.</li>
            <li>Arbitrary uploaded ZIP/SQL files as trusted backups: only WP Doctor AI transfer packages are accepted.</li>
            <li>Production operation with local-only storage or without an encryption key: blocked by the storage/encryption gates.</li>
            <li>Manual next steps after a blocked restore/migration: verify the dry-run plan, create a verified backup of the destination by hand, and restore it manually from the downloaded archive if needed — the download route streams the verified archive under a one-use token.</li>
          </ul>
        </section>
      </main>
    </PageContainer>
  );
}
