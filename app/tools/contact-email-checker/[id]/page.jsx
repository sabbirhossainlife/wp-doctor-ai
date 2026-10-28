import { redirect, notFound } from "next/navigation";
import Container from "../../../../components/Container";
import ContactEmailAiSection from "../../../../components/ContactEmailAiSection";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";
import { publicContactEmailAnalysis } from "../../../../lib/contact-email/ai";

export default async function ContactEmailDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const diagnostic = await prisma.contactEmailDiagnostic.findFirst({
    where: { id, userId: user.id },
    include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
  });
  if (!diagnostic) notFound();

  const summary = diagnostic.summary && typeof diagnostic.summary === "object" ? diagnostic.summary : {};
  const snapshotCopy = diagnostic.snapshotCopy && typeof diagnostic.snapshotCopy === "object" ? diagnostic.snapshotCopy : {};
  const spf = diagnostic.spfObservation && typeof diagnostic.spfObservation === "object" ? diagnostic.spfObservation : {};
  const dmarc = diagnostic.dmarcObservation && typeof diagnostic.dmarcObservation === "object" ? diagnostic.dmarcObservation : {};
  const dkim = diagnostic.dkimObservation && typeof diagnostic.dkimObservation === "object" ? diagnostic.dkimObservation : {};
  const observed = diagnostic.findings.filter((f) => f.evidenceStatus === "CONFIRMED");
  const potential = diagnostic.findings.filter((f) => f.evidenceStatus === "POTENTIAL");
  const insufficient = diagnostic.findings.filter((f) => f.evidenceStatus === "INSUFFICIENT_EVIDENCE" || !f.evidenceStatus);

  function findingList(list) {
    return (
      <ul className="mt-3 space-y-3">
        {list.map((f) => (
          <li key={f.id} className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
            <p><strong>{f.title}</strong> <span className="text-slate-500">({f.code} · {f.severity} · confidence {f.confidence})</span></p>
            <p className="mt-1">{f.explanation}</p>
            <p className="mt-1"><strong>Recommended next step:</strong> {f.recommendation}</p>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Contact/email report</h1>
        <p className="mt-2 text-slate-600">
          Target: {diagnostic.sanitizedTargetUrl} · Status: {diagnostic.executionStatus}
          {diagnostic.sanitizedEmailDomain ? ` · Email domain: ${diagnostic.sanitizedEmailDomain} (${summary.emailDomainSource ?? "unknown"} source)` : " · Email domain: unknown"}
          {" · "}{new Date(diagnostic.createdAt).toLocaleString()}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Snapshot: {diagnostic.snapshotSchemaVersion ? `schema v${diagnostic.snapshotSchemaVersion}` : "none (URL-only run)"}
          {diagnostic.snapshotReceivedAt ? `, received ${new Date(diagnostic.snapshotReceivedAt).toLocaleString()}` : ""}
          {` · freshness: ${diagnostic.snapshotFreshness}`}
        </p>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ce-observed-heading">
          <h2 id="ce-observed-heading" className="text-lg font-semibold">Observed configuration</h2>
          {Array.isArray(snapshotCopy.contactForms) && snapshotCopy.contactForms.length > 0 ? (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">Form plugins (snapshot, normalised indicators only)</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {snapshotCopy.contactForms.map((f, i) => (
                  <li key={i}>{f.name} — installed: {f.installed ? "yes" : "no"}, active: {f.active ? "yes" : "no"}, coverage: {f.coverage}{f.version ? `, version ${f.version}` : ""}{f.formsCount !== null && f.formsCount !== undefined ? `, forms: ${f.formsCount}` : ""}{f.mailConfigStatus ? `, notification config: ${f.mailConfigStatus}` : ""}</li>
                ))}
              </ul>
            </div>
          ) : <p className="mt-2 text-sm text-slate-700">No form-plugin snapshot data in this report (URL-only run or pre-v5 snapshot).</p>}
          {Array.isArray(snapshotCopy.mailTransport) && snapshotCopy.mailTransport.length > 0 ? (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">Mail transport (snapshot, normalised indicators only)</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {snapshotCopy.mailTransport.map((m, i) => (
                  <li key={i}>{m.name} — installed: {m.installed ? "yes" : "no"}, active: {m.active ? "yes" : "no"}, coverage: {m.coverage}{m.mailer ? `, mailer: ${m.mailer}` : ""}{m.senderConfigured ? `, sender configured: ${m.senderConfigured}` : ""}{m.senderDomain ? `, sender domain: ${m.senderDomain}` : ""}{m.requiredFieldsComplete ? `, required fields complete: ${m.requiredFieldsComplete}` : ""}</li>
                ))}
              </ul>
            </div>
          ) : <p className="mt-2 text-sm text-slate-700">No mail-transport snapshot data in this report.</p>}
          {snapshotCopy.senderComparison ? (
            <p className="mt-3 text-sm text-slate-700">
              Sender-domain comparison: {snapshotCopy.senderComparison.comparisonEstablished ? (snapshotCopy.senderComparison.domainMatches ? "sender domain matches the checked email domain." : "sender domain does NOT match the checked email domain.") : "not established (sender domain or email domain unknown)."}
            </p>
          ) : null}
          {observed.length > 0 ? findingList(observed) : <p className="mt-2 text-sm text-slate-700">No confirmed observations in this report.</p>}
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ce-dns-heading">
          <h2 id="ce-dns-heading" className="text-lg font-semibold">DNS results (public records only)</h2>
          <div className="mt-2 space-y-1 text-sm text-slate-700">
            <p>SPF ({diagnostic.sanitizedEmailDomain ?? "no domain"}): {spf.status ?? "—"}{spf.spfRecord ? ` — excerpt: ${spf.spfRecord}` : ""}</p>
            <p>DMARC (_dmarc.{diagnostic.sanitizedEmailDomain ?? "no domain"}): {dmarc.status ?? "—"}{dmarc.policy ? ` (p=${dmarc.policy})` : ""}{dmarc.dmarcRecord ? ` — excerpt: ${dmarc.dmarcRecord}` : ""}</p>
            <p>DKIM ({diagnostic.dkimSelector ? `${diagnostic.dkimSelector}._domainkey.${diagnostic.sanitizedEmailDomain ?? ""}` : "no selector supplied"}): {dkim.status ?? "—"}</p>
          </div>
          <p className="mt-2 text-sm text-slate-600">Excerpts are bounded public TXT text only. Record presence is not a signature or delivery test.</p>
        </section>

        {potential.length > 0 ? (
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ce-potential-heading">
            <h2 id="ce-potential-heading" className="text-lg font-semibold">Potential issues</h2>
            {findingList(potential)}
          </section>
        ) : null}

        {insufficient.length > 0 ? (
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ce-insufficient-heading">
            <h2 id="ce-insufficient-heading" className="text-lg font-semibold">Not checked — insufficient evidence</h2>
            <p className="mt-2 text-sm text-slate-600">These items could not be assessed from the available evidence. They are not passes and not confirmed defects.</p>
            {findingList(insufficient)}
          </section>
        ) : null}

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ce-actions-heading">
          <h2 id="ce-actions-heading" className="text-lg font-semibold">Recommended actions</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {diagnostic.findings.map((f) => (
              <li key={f.id}><strong>{f.code}:</strong> {f.recommendation}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-slate-600">
            This report never sent an email, submitted a form, or verified delivery. If delivery problems are reported, verify actual delivery with the mail provider&apos;s own logs and test tools.
          </p>
        </section>

        <ContactEmailAiSection diagnosticId={diagnostic.id} initial={publicContactEmailAnalysis(diagnostic.aiAnalysis)} />
      </main>
    </Container>
  );
}
