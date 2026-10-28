import { notFound, redirect } from "next/navigation";
import Container from "../../../../components/Container";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";
import { SCAN_LIMITATION_NOTE } from "../../../../lib/diagnostics/classify";
import AiAnalysisSection from "../../../../components/AiAnalysisSection";
import { getAiConfig, isAiConfigured, publicAnalysis } from "../../../../lib/ai/analyze";

const SEVERITY_STYLE = {
  info: "bg-blue-50 text-blue-800 border-blue-200",
  low: "bg-slate-100 text-slate-800 border-slate-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  high: "bg-red-50 text-red-800 border-red-200",
};

function outcomeLabel(outcome) {
  return outcome.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default async function ScanReportPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  // Ownership enforced in the query: another user's report simply does not match.
  const scan = await prisma.scan.findFirst({
    where: { id, userId: user.id },
    include: { findings: { orderBy: { createdAt: "asc" } } },
  });
  if (!scan) notFound();
  const aiRow = await prisma.aiAnalysis.findUnique({ where: { scanId: scan.id } });
  const aiAnalysis = publicAnalysis(aiRow);
  const aiConfigured = isAiConfigured(getAiConfig());

  return (
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Scan report</h1>
        <dl className="mt-6 space-y-2 text-sm text-slate-700">
          <div className="flex gap-2"><dt className="font-semibold">Target:</dt><dd>{scan.targetUrl}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Outcome:</dt><dd>{outcomeLabel(scan.diagnosticOutcome)}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Scan status:</dt><dd>{scan.executionStatus}</dd></div>
          {scan.httpStatus != null && (<div className="flex gap-2"><dt className="font-semibold">HTTP status:</dt><dd>{scan.httpStatus}</dd></div>)}
          {scan.durationMs != null && (<div className="flex gap-2"><dt className="font-semibold">Response time:</dt><dd>{scan.durationMs} ms</dd></div>)}
          {scan.redirectCount != null && (<div className="flex gap-2"><dt className="font-semibold">Redirects:</dt><dd>{scan.redirectCount}</dd></div>)}
          {scan.finalUrl && (<div className="flex gap-2"><dt className="font-semibold">Final URL:</dt><dd>{scan.finalUrl}</dd></div>)}
          {scan.errorCode && (<div className="flex gap-2"><dt className="font-semibold">Error code:</dt><dd>{scan.errorCode}</dd></div>)}
          <div className="flex gap-2"><dt className="font-semibold">Scanned:</dt><dd>{new Date(scan.createdAt).toLocaleString()}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Scan ID:</dt><dd>{scan.id}</dd></div>
        </dl>

        <section className="mt-10" aria-labelledby="findings-heading">
          <h2 id="findings-heading" className="text-2xl font-semibold">Findings</h2>
          {scan.findings.length === 0 ? (
            <p className="mt-4 text-slate-600">No findings were recorded for this scan.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {scan.findings.map((f) => (
                <li key={f.id} className={`rounded-xl border p-5 ${SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.low}`}>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm">Severity: {f.severity} · Status: {f.status}</p>
                  <p className="mt-2 text-sm">{f.description}</p>
                  {f.recommendation && (
                    <p className="mt-2 text-sm"><strong>Recommended next step:</strong> {f.recommendation}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <AiAnalysisSection scanId={scan.id} initialAnalysis={aiAnalysis} aiConfigured={aiConfigured} />

        <section className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-5" aria-labelledby="limits-heading">
          <h2 id="limits-heading" className="text-lg font-semibold">Diagnostic limitation</h2>
          <p className="mt-2 text-sm text-slate-700">{SCAN_LIMITATION_NOTE}</p>
          <p className="mt-2 text-sm text-slate-700">
            Findings above describe what was observed, not a confirmed root
            cause, unless the finding itself says so.
          </p>
        </section>

        <p className="mt-8 text-sm">
          <a className="font-medium text-blue-700 underline" href="/tools/error-checker">Scan again</a>
          {" · "}
          <a className="font-medium text-blue-700 underline" href="/tools/error-checker/history">Back to scan history</a>
        </p>
      </main>
    </Container>
  );
}
