import { redirect, notFound } from "next/navigation";
import Container from "../../../../components/Container";
import SpeedAiSection from "../../../../components/SpeedAiSection";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";
import { publicSpeedAnalysis } from "../../../../lib/speed/ai";

function fmtMs(v) {
  return typeof v === "number" ? `${v} ms` : "UNAVAILABLE";
}
function fmtCls(v) {
  return typeof v === "number" ? String(v) : "UNAVAILABLE";
}

export default async function SpeedDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const diagnostic = await prisma.speedDiagnostic.findFirst({
    where: { id, userId: user.id },
    include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
  });
  if (!diagnostic) notFound();

  const http = diagnostic.httpSummary ?? {};
  const lab = diagnostic.lighthouseSummary;
  const field = diagnostic.cruxSummary;
  const statuses = diagnostic.providerStatuses ?? {};
  const notices = Array.isArray(diagnostic.notices) ? diagnostic.notices : [];

  return (
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Speed report</h1>
        <p className="mt-2 text-slate-600">
          Submitted target: {diagnostic.requestedTarget} · Provider target: {diagnostic.providerTarget ?? "—"} (query stripped: {diagnostic.queryStripped ? "yes" : "no"}) ·
          Strategy: {diagnostic.strategy} · Status: {diagnostic.status} · {new Date(diagnostic.createdAt).toLocaleString()}
        </p>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="http-heading">
          <h2 id="http-heading" className="text-lg font-semibold">Basic HTTP diagnostics</h2>
          <p className="mt-2 text-sm text-slate-700">
            Status: {http.status ?? "—"} · Total response time: {fmtMs(http.elapsedMs)} (all redirects included — this is NOT time-to-first-byte) ·
            Redirects: {http.redirectCount ?? "—"}
            {http.errorCode ? ` · Preflight error: ${http.errorCode}` : ""}
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="lab-heading">
          <h2 id="lab-heading" className="text-lg font-semibold">Lab data — Lighthouse (Google lab run)</h2>
          {lab ? (
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <p>Performance score (lab only, not a ranking score): {lab.score100} / 100</p>
              <p>First Contentful Paint (lab): {fmtMs(lab.fcpMs)}</p>
              <p>Largest Contentful Paint (lab): {fmtMs(lab.lcpMs)} — good ≤ 2500 ms, needs improvement ≤ 4000 ms</p>
              <p>Total Blocking Time (lab only — never INP): {fmtMs(lab.tbtMs)}</p>
              <p>Cumulative Layout Shift (lab): {fmtCls(lab.cls)} — good &lt; 0.1, needs improvement ≤ 0.25</p>
              <p>Speed Index (lab): {fmtMs(lab.speedIndexMs)} · Interactive (lab): {fmtMs(lab.interactiveMs)}</p>
              {lab.inpMs !== null && lab.inpMs !== undefined ? <p>Interaction to Next Paint (lab, only when Lighthouse reports it): {fmtMs(lab.inpMs)}</p> : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-700">UNAVAILABLE — PageSpeed Insights status: {statuses.psi ?? "unknown"}. Lab data is missing; it is not zero and not a pass.</p>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="field-heading">
          <h2 id="field-heading" className="text-lg font-semibold">Field data — Chrome UX Report (real users)</h2>
          {field ? (
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <p>Scope: {field.scope === "origin" ? "ORIGIN-LEVEL — describes the whole origin, not this exact page" : "PAGE-LEVEL"} · Form factor: {field.formFactor}</p>
              <p>
                Collection period: {field.collectionPeriod?.firstDate ? `${field.collectionPeriod.firstDate.year}-${field.collectionPeriod.firstDate.month}-${field.collectionPeriod.firstDate.day}` : "not reported"}
                {" to "}
                {field.collectionPeriod?.lastDate ? `${field.collectionPeriod.lastDate.year}-${field.collectionPeriod.lastDate.month}-${field.collectionPeriod.lastDate.day}` : "not reported"}
              </p>
              <p>LCP p75 (field): {fmtMs(field.metrics?.lcp?.p75Ms)} — {field.metrics?.lcp?.classification ?? "UNAVAILABLE"}</p>
              <p>INP p75 (field): {fmtMs(field.metrics?.inp?.p75Ms)} — {field.metrics?.inp?.classification ?? "UNAVAILABLE"}</p>
              <p>CLS p75 (field): {fmtCls(field.metrics?.cls?.p75)} — {field.metrics?.cls?.classification ?? "UNAVAILABLE"}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-700">UNAVAILABLE — CrUX status: {statuses.crux ?? "unknown"}. No field record means no real-user data for this target; it is not zero and not a pass.</p>
          )}
        </section>

        {notices.length > 0 ? (
          <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6" aria-labelledby="notices-heading">
            <h2 id="notices-heading" className="text-lg font-semibold">Availability notes</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {notices.map((n, i) => (
                <li key={i}><strong>{n.code}:</strong> {n.detail}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="findings-heading">
          <h2 id="findings-heading" className="text-lg font-semibold">Findings ({diagnostic.findings.length})</h2>
          {diagnostic.findings.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No findings from the available evidence. A missing source is a gap in evidence, not proof of good performance.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {diagnostic.findings.map((f) => (
                <li key={f.id} className="border-b border-slate-100 pb-4 last:border-0">
                  <p className="font-medium text-slate-800">{f.title} <span className="text-xs font-normal text-slate-500">· {f.severity} · source: {f.source}{f.sourceAuditId ? ` · audit: ${f.sourceAuditId}` : ""}</span></p>
                  <p className="mt-1 text-sm text-slate-700">{f.description}</p>
                  {f.evidence?.estimatedSavingsMs || f.evidence?.estimatedSavingsBytes ? (
                    <p className="mt-1 text-sm text-slate-600">Estimated potential savings (provider estimate only, not guaranteed): {f.evidence.estimatedSavingsMs ? `${f.evidence.estimatedSavingsMs} ms ` : ""}{f.evidence.estimatedSavingsBytes ? `${f.evidence.estimatedSavingsBytes} bytes` : ""}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-slate-700"><strong>Recommendation:</strong> {f.recommendation}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <SpeedAiSection diagnosticId={diagnostic.id} initial={publicSpeedAnalysis(diagnostic.aiAnalysis)} />
      </main>
    </Container>
  );
}
