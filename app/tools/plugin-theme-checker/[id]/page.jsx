import { notFound, redirect } from "next/navigation";
import PageContainer from "../../../../components/PageContainer";
import ConflictAiSection from "../../../../components/ConflictAiSection";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";
import { getAiConfig, isAiConfigured } from "../../../../lib/ai/analyze";
import { publicConflictAnalysis } from "../../../../lib/conflict/ai";

const SEVERITY_STYLE = {
  LOW: "bg-slate-100 text-slate-800 border-slate-200",
  MEDIUM: "bg-amber-50 text-amber-800 border-amber-200",
  HIGH: "bg-red-50 text-red-800 border-red-200",
};

function categoryLabel(value) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default async function ConflictReportPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  // Ownership enforced in the query: another user's report simply does not match.
  const diagnostic = await prisma.conflictDiagnostic.findFirst({
    where: { id, userId: user.id },
    include: { website: true, findings: { orderBy: { createdAt: "asc" } } },
  });
  if (!diagnostic) notFound();
  const aiRow = await prisma.conflictAiAnalysis.findUnique({ where: { diagnosticId: diagnostic.id } });
  const aiAnalysis = publicConflictAnalysis(aiRow);
  const aiConfigured = isAiConfigured(getAiConfig());
  const payload = diagnostic.snapshotPayload && typeof diagnostic.snapshotPayload === "object" ? diagnostic.snapshotPayload : {};

  return (
    <PageContainer>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Conflict check report</h1>
        <dl className="mt-6 space-y-2 text-sm text-slate-700">
          <div className="flex gap-2"><dt className="font-semibold">Website:</dt><dd>{diagnostic.website?.name} — {diagnostic.website?.normalizedUrl}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Symptom:</dt><dd>{categoryLabel(diagnostic.symptomCategory)}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Description:</dt><dd>{diagnostic.symptomDescription}</dd></div>
          {diagnostic.errorExcerpt && (<div className="flex gap-2"><dt className="font-semibold">Error excerpt (user-supplied, untrusted):</dt><dd>{diagnostic.errorExcerpt}</dd></div>)}
          <div className="flex gap-2"><dt className="font-semibold">WordPress:</dt><dd>{payload.wordpressVersion ?? "unknown"}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">PHP:</dt><dd>{payload.phpVersion ?? "unknown"}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Snapshot:</dt><dd>v{diagnostic.snapshotSchemaVersion}, received {new Date(diagnostic.snapshotReceivedAt).toLocaleString()}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Checked:</dt><dd>{new Date(diagnostic.createdAt).toLocaleString()}</dd></div>
        </dl>

        <section className="mt-10" aria-labelledby="conflict-findings-heading">
          <h2 id="conflict-findings-heading" className="text-2xl font-semibold">Deterministic findings</h2>
          <p className="mt-2 text-sm text-slate-600">
            These findings come only from the snapshot and the rules. They do
            not claim a plugin caused your symptom, and no finding is based
            on logs or TLS data, which are not collected.
          </p>
          {diagnostic.findings.length === 0 ? (
            <p className="mt-4 text-slate-600">No findings were recorded for this check.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {diagnostic.findings.map((f) => (
                <li key={f.id} className={`rounded-xl border p-5 ${SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.LOW}`}>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm">Rule {f.ruleId} · {f.category} · Severity: {f.severity} · Status: {f.status} · Confidence: {f.confidence}</p>
                  <p className="mt-2 text-sm">{f.description}</p>
                  {f.referencedItems && Array.isArray(f.referencedItems) && f.referencedItems.length > 0 && (
                    <p className="mt-2 text-sm">
                      <strong>Items:</strong>{" "}
                      {f.referencedItems.map((it) => `${it.kind}: ${it.name ?? it.slug ?? "unknown"}`).join("; ")}
                    </p>
                  )}
                  {f.requiredAdditionalEvidence && (
                    <p className="mt-2 text-sm"><strong>Still needed:</strong> {f.requiredAdditionalEvidence}</p>
                  )}
                  {f.recommendation && (
                    <p className="mt-2 text-sm"><strong>Recommended next step:</strong> {f.recommendation}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <ConflictAiSection diagnosticId={diagnostic.id} initialAnalysis={aiAnalysis} aiConfigured={aiConfigured} />

        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="safe-steps-heading">
          <h2 id="safe-steps-heading" className="text-lg font-semibold">Safe next steps (manual only — nothing here is executed by this app)</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Back up the site (files + database) before changing anything.</li>
            <li>Reproduce the symptom on a staging copy first, not on the live site.</li>
            <li>On staging only, test one change at a time (for example, updating one plugin or activating one dependency) and record whether the symptom changes.</li>
            <li>Note the exact page or feature affected and the exact error text for an expert, if the issue persists.</li>
            <li>Ask your hosting provider for the PHP error details for the affected time window, if you need log evidence — this app does not collect logs.</li>
          </ul>
          <p className="mt-3 text-sm font-medium text-amber-800">
            Risk notice: deactivating plugins, switching themes, or editing
            settings on a live site can break it further. Do these steps on
            staging, with a backup, or with expert help.
          </p>
        </section>
      </main>
    </PageContainer>
  );
}
