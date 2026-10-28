import { redirect, notFound } from "next/navigation";
import PageContainer from "../../../../components/PageContainer";
import SslRedirectAiSection from "../../../../components/SslRedirectAiSection";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";
import { publicSslAnalysis } from "../../../../lib/ssl/ai";

export default async function SslDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const diagnostic = await prisma.sslRedirectDiagnostic.findFirst({
    where: { id, userId: user.id },
    include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
  });
  if (!diagnostic) notFound();

  const tls = diagnostic.tlsOutcome && typeof diagnostic.tlsOutcome === "object" ? diagnostic.tlsOutcome : null;
  const summary = diagnostic.summary && typeof diagnostic.summary === "object" ? diagnostic.summary : {};
  const chain = Array.isArray(diagnostic.redirectChain) ? diagnostic.redirectChain : [];
  const limitations = Array.isArray(diagnostic.limitations) ? diagnostic.limitations : [];

  return (
    <PageContainer>
      <main className="py-12">
        <h1 className="text-3xl font-bold">SSL report</h1>
        <p className="mt-2 text-slate-600">
          Submitted target: {diagnostic.sanitizedTargetUrl} · Status: {diagnostic.executionStatus} · {new Date(diagnostic.createdAt).toLocaleString()}
        </p>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ssl-cert-heading">
          <h2 id="ssl-cert-heading" className="text-lg font-semibold">Certificate status</h2>
          {tls && tls.scheme === "https" ? (
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <p>Certificate status: {summary.certStatus ?? "UNKNOWN"}</p>
              <p>Verified: {tls.verified ? "yes" : "no"}</p>
              {tls.verified && tls.certificate ? (
                <>
                  <p>Hostname verified: {tls.certificate.hostname ?? "—"}</p>
                  <p>Issuer: {tls.certificate.issuer ?? "—"}</p>
                  <p>Valid from: {tls.certificate.validFrom ?? "—"}</p>
                  <p>Valid to: {tls.certificate.validTo ?? "—"}</p>
                  <p>Days to expiry: {tls.daysToExpiry ?? "—"}</p>
                  <p>Protocol: {tls.certificate.protocol ?? "—"} · Cipher: {tls.certificate.cipher ?? "—"}</p>
                  {Array.isArray(tls.certificate.san) && tls.certificate.san.length > 0 ? (
                    <p>Subject alternative names: {tls.certificate.san.join(", ")}</p>
                  ) : null}
                </>
              ) : (
                <p>
                  No certificate details are shown: the handshake did not verify
                  {tls.errorCode ? ` (error: ${tls.errorCode})` : ""}. Certificate details are
                  recorded only when verification succeeds.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-700">
              No TLS certificate applies to this report (the target was reached over plain HTTP, or no TLS handshake was attempted).
            </p>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ssl-chain-heading">
          <h2 id="ssl-chain-heading" className="text-lg font-semibold">Redirect chain</h2>
          {chain.length === 0 ? (
            <p className="mt-2 text-sm text-slate-700">No hops were recorded — the target was blocked before any connection.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {chain.map((hop, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
                  <p><strong>Step {hop.step ?? i}:</strong> {hop.url ?? "—"}</p>
                  <p>
                    Status: {typeof hop.status === "number" ? hop.status : "no HTTP response (connection did not reach an HTTP response)"} ·
                    Scheme: {hop.scheme ?? "—"} · Outcome: {hop.outcome ?? "—"}
                    {hop.destination ? ` · Destination: ${hop.destination}` : ""}
                  </p>
                  <p>
                    Hostname changed: {hop.hostChanged ? "yes" : "no"}
                    {hop.tlsResult ? ` · TLS verified: ${hop.tlsResult.verified ? "yes" : "no"}${hop.tlsResult.errorCode ? ` (${hop.tlsResult.errorCode})` : ""}` : " · TLS: not applicable (plain HTTP)"}
                    {hop.errorCode ? ` · Error: ${hop.errorCode}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-sm text-slate-600">
            Final URL: {summary.finalUrl ?? "—"} · Final status: {summary.finalStatus ?? "—"} · Redirects: {summary.redirectCount ?? "—"} ·
            Cross-host: {summary.crossHost ? "yes" : "no"} · Downgrade blocked: {summary.downgradeBlocked ? "yes" : "no"}
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ssl-findings-heading">
          <h2 id="ssl-findings-heading" className="text-lg font-semibold">Findings</h2>
          {diagnostic.findings.length === 0 ? (
            <p className="mt-2 text-sm text-slate-700">No findings were recorded for this report.</p>
          ) : (
            <ul className="mt-3 space-y-4">
              {diagnostic.findings.map((f) => (
                <li key={f.id} className="rounded-lg border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-800">{f.title} <span className="font-normal text-slate-500">({f.code} · {f.severity} · confidence {f.confidence})</span></p>
                  <p className="mt-1 text-sm text-slate-700">{f.explanation}</p>
                  <p className="mt-1 text-sm text-slate-700"><strong>Recommended action:</strong> {f.recommendation}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {limitations.length > 0 ? (
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ssl-limits-detail-heading">
            <h2 id="ssl-limits-detail-heading" className="text-lg font-semibold">Limitations</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <SslRedirectAiSection diagnosticId={diagnostic.id} initial={publicSslAnalysis(diagnostic.aiAnalysis)} />
        <p className="mt-6 text-sm text-slate-600">
          <a className="font-medium text-blue-700 underline" href="/tools/ssl-redirect-checker/history">Back to SSL history</a>
        </p>
      </main>
    </PageContainer>
  );
}
