import { notFound, redirect } from "next/navigation";
import PageContainer from "../../../../components/PageContainer";
import ElementorAiSection from "../../../../components/ElementorAiSection";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";
import { getAiConfig, isAiConfigured } from "../../../../lib/ai/analyze";
import { publicElementorAnalysis } from "../../../../lib/elementor/ai";

const SEVERITY_STYLE = {
  LOW: "bg-slate-100 text-slate-800 border-slate-200",
  MEDIUM: "bg-amber-50 text-amber-800 border-amber-200",
  HIGH: "bg-red-50 text-red-800 border-red-200",
};

function categoryLabel(value) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default async function ElementorReportPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  // Ownership enforced in the query: another user's report simply does not match.
  const diagnostic = await prisma.elementorDiagnostic.findFirst({
    where: { id, userId: user.id },
    include: { website: true, findings: { orderBy: { createdAt: "asc" } } },
  });
  if (!diagnostic) notFound();
  const aiRow = await prisma.elementorAiAnalysis.findUnique({ where: { diagnosticId: diagnostic.id } });
  const aiAnalysis = publicElementorAnalysis(aiRow);
  const aiConfigured = isAiConfigured(getAiConfig());
  const payload = diagnostic.snapshotPayload && typeof diagnostic.snapshotPayload === "object" ? diagnostic.snapshotPayload : {};
  const el = payload.elementor && typeof payload.elementor === "object" ? payload.elementor : null;
  const env = payload.environment && typeof payload.environment === "object" ? payload.environment : null;

  return (
    <PageContainer>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Elementor &amp; layout report</h1>
        <dl className="mt-6 space-y-2 text-sm text-slate-700">
          <div className="flex gap-2"><dt className="font-semibold">Website:</dt><dd>{diagnostic.website?.name} — {diagnostic.website?.normalizedUrl}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Symptom:</dt><dd>{categoryLabel(diagnostic.symptomCategory)}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Description:</dt><dd>{diagnostic.symptomDescription}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Where (reported):</dt><dd>{diagnostic.affectedScope}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Pages (reported):</dt><dd>{diagnostic.affectedPages}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Device (reported):</dt><dd>{diagnostic.deviceScope}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Followed an update (reported):</dt><dd>{diagnostic.updatePreceded}</dd></div>
          {diagnostic.startedAt && (<div className="flex gap-2"><dt className="font-semibold">Started:</dt><dd>{diagnostic.startedAt}</dd></div>)}
          {diagnostic.errorExcerpt && (<div className="flex gap-2"><dt className="font-semibold">Error excerpt (user-supplied, untrusted, never verified console evidence):</dt><dd>{diagnostic.errorExcerpt}</dd></div>)}
          <div className="flex gap-2"><dt className="font-semibold">WordPress:</dt><dd>{payload.wordpressVersion ?? "unknown"}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">PHP:</dt><dd>{payload.phpVersion ?? "unknown"}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Elementor:</dt><dd>{el ? `${el.status}${el.version ? `, version ${el.version}` : ", version unknown"}` : "not present in this snapshot (legacy)"}</dd></div>
          {el?.pro && (<div className="flex gap-2"><dt className="font-semibold">Elementor Pro:</dt><dd>{el.pro.installed ? (el.pro.active ? "active" : "installed, inactive") : "not installed"}{el.pro.version ? `, version ${el.pro.version}` : ", version unknown"}</dd></div>)}
          {env && (<div className="flex gap-2"><dt className="font-semibold">Configured limits:</dt><dd>WP memory {env.wpMemoryLimit ?? "unavailable"} · PHP memory {env.phpMemoryLimit ?? "unavailable"} · Max execution time {env.maxExecutionTime ?? "unavailable"} (configured values, not observed usage)</dd></div>)}
          <div className="flex gap-2"><dt className="font-semibold">Snapshot:</dt><dd>v{diagnostic.snapshotSchemaVersion}, received {new Date(diagnostic.snapshotReceivedAt).toLocaleString()}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Checked:</dt><dd>{new Date(diagnostic.createdAt).toLocaleString()}</dd></div>
        </dl>

        <section className="mt-10" aria-labelledby="el-findings-heading">
          <h2 id="el-findings-heading" className="text-2xl font-semibold">Deterministic findings</h2>
          <p className="mt-2 text-sm text-slate-600">
            These findings come only from the snapshot and the rules. Technical
            configuration findings are kept separate from visual-layout
            symptoms: no finding claims a layout was visually verified, a
            console error was confirmed, or a plugin was proven to cause a
            symptom — no rendering test, console inspection, isolation test,
            or screenshot analysis exists in this tool.
          </p>
          {diagnostic.findings.length === 0 ? (
            <p className="mt-4 text-slate-600">No findings were recorded for this check. That means the checked configuration items matched — it is not a guarantee that the editor or layout works.</p>
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

        <ElementorAiSection diagnosticId={diagnostic.id} initialAnalysis={aiAnalysis} aiConfigured={aiConfigured} />

        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="safe-steps-heading">
          <h2 id="safe-steps-heading" className="text-lg font-semibold">Safe next steps (manual only — nothing here is executed by this app)</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Back up the site (files + database) before changing anything.</li>
            <li>Review Elementor System Info (Elementor &gt; System Info) and Site Health for the configured memory and version values in this report.</li>
            <li>Try Safe Mode only as an editor diagnostic view (Elementor &gt; Tools, authorized admin, editor session only) and disable it again after testing. Safe Mode is not a fix for live-page layout and never guarantees a fix.</li>
            <li>For a suspected conflict, run the Plugin &amp; Theme Conflict Checker and test on staging, one component at a time. Never permanently deactivate a security plugin, and never deactivate plugins or switch themes on the live site to test.</li>
            <li>Check the WordPress Address vs Site Address in Settings &gt; General on staging first: protocol and hostname must match; a subdirectory path difference is legitimate.</li>
            <li>For a frontend layout symptom, visually inspect the affected page on staging at the affected device sizes — this report does not verify layout visually, and no screenshot upload is offered.</li>
            <li>Test every change on a staging copy first, not on the live site.</li>
            <li>Note the exact editor step, the exact message, and whether the symptom reproduces in Safe Mode and on staging, for an expert if the issue persists.</li>
          </ul>
          <p className="mt-3 text-sm font-medium text-amber-800">
            Risk notice: changing URLs, memory configuration, plugin activation,
            or themes on a live site can break the editor or frontend further.
            Do these steps on staging, with a backup, or with expert help.
          </p>
        </section>
      </main>
    </PageContainer>
  );
}
