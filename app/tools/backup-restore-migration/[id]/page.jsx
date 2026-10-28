import { redirect } from "next/navigation";
import Container from "../../../../components/Container";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";

export default async function BackupDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const artifact = await prisma.backupArtifact.findFirst({ where: { id, userId: user.id } });
  if (!artifact) redirect("/tools/backup-restore-migration");
  const manifest = artifact.manifest ?? {};
  return (
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Backup detail</h1>
        <p className="mt-3 text-slate-600">Backup contents are never displayed here — only the manifest summary, counts, sizes, and integrity status.</p>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
          <dl className="space-y-2 text-sm text-slate-700">
            <div><dt className="font-medium">Backup ID</dt><dd>{artifact.id}</dd></div>
            <div><dt className="font-medium">Mode</dt><dd>{artifact.mode}</dd></div>
            <div><dt className="font-medium">Status</dt><dd>{artifact.status}</dd></div>
            <div><dt className="font-medium">Verification</dt><dd>{artifact.verificationStatus}</dd></div>
            <div><dt className="font-medium">Site identity</dt><dd>{manifest.siteIdentity?.canonicalHost ?? "unknown"}</dd></div>
            <div><dt className="font-medium">Created</dt><dd>{artifact.createdAt.toISOString()}</dd></div>
            <div><dt className="font-medium">Archive size</dt><dd>{artifact.archiveBytes ?? "unknown"} bytes</dd></div>
            <div><dt className="font-medium">Archive SHA-256</dt><dd className="break-all">{artifact.archiveSha256 ?? "unknown"}</dd></div>
            <div><dt className="font-medium">Files / tables</dt><dd>{artifact.fileCount} / {artifact.tableCount}</dd></div>
            <div><dt className="font-medium">Included categories</dt><dd>{(manifest.includedCategories ?? []).join(", ") || "none"}</dd></div>
            <div><dt className="font-medium">Excluded categories</dt><dd>{(manifest.excludedCategories ?? []).join(", ") || "none"}</dd></div>
            <div><dt className="font-medium">Includes wp-config.php</dt><dd>{manifest.includesWpConfig ? "Yes — same-site recovery archive only, with secrets warning" : "No"}</dd></div>
            <div><dt className="font-medium">Encryption</dt><dd>{artifact.encryptionScheme} (key id {artifact.encryptionKeyId ?? "unknown"} — key never shown)</dd></div>
            <div><dt className="font-medium">Limitations</dt><dd>{(manifest.limitations ?? []).join(" ")}</dd></div>
          </dl>
          <p className="mt-4 text-sm text-slate-600">Retention: backups are never silently deleted by an internal default. Deletion is owner-initiated (API) and is refused while an active operation needs the backup; rollback copies are preserved while their operation is active or uncertain. Download uses a one-use, 5-minute token via the API and streams the archive — no permanent public URL exists.</p>
          <p className="mt-3 text-sm text-slate-600"><a className="font-medium text-blue-700 underline" href="/tools/backup-restore-migration">Back to Backup, Restore &amp; Migration</a></p>
        </section>
      </main>
    </Container>
  );
}
