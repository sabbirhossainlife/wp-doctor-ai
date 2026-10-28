import { redirect } from "next/navigation";
import Container from "../../../components/Container";
import ContactEmailCheckerForm from "../../../components/ContactEmailCheckerForm";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";

export default async function ContactEmailCheckerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const websites = await prisma.website.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Contact Form &amp; Email Checker</h1>
        <p className="mt-3 text-slate-600">
          Read-only diagnosis of a site&apos;s contact forms and email setup,
          separately and honestly: recognised form plugins and their
          notification configuration (from a connector snapshot), the mail
          transport plugin&apos;s apparent configuration, and public SPF,
          DMARC, and DKIM DNS records for the email domain. Nothing is sent
          and nothing is submitted — this tool never sends an email, never
          submits a form, never connects to a mail server, and never verifies
          delivery. A complete configuration and present DNS records still do
          not guarantee that mail reaches an inbox.
        </p>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <ContactEmailCheckerForm websites={websites.map((w) => ({ id: w.id, name: w.name, normalizedUrl: w.normalizedUrl }))} />
        </div>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ce-limits-heading">
          <h2 id="ce-limits-heading" className="text-lg font-semibold">What this check can and cannot do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Observed configuration is shown separately from potential issues and from AI explanation, and separately again from anything not checked for lack of evidence.</li>
            <li>Form and mail configuration come only from a connector snapshot (plugin 1.4.0, schema v5) no more than 24 hours old. Older snapshots report insufficient evidence, never a broken plugin; a stale snapshot blocks the run with re-sync instructions and no report is saved.</li>
            <li>An absent recognised plugin does not mean the site has no forms: custom forms and unsupported plugins are reported as unsupported, never as absent.</li>
            <li>An absent mail plugin is not a failure: WordPress may use PHP mail or another integration. A configured mail plugin does not prove authentication works or mail is delivered.</li>
            <li>SPF is checked only for presence, multiple records, and three reliably detectable anomalies — not full compliance, lookup limits, or include chains. DMARC p=none is monitoring, not an error, and this tool never recommends a policy change automatically.</li>
            <li>DKIM is checked only with a selector you supply (or one reliably available from supported non-secret config). Without a selector it is not checked, never guessed, and never declared missing.</li>
            <li>DNS results show the queried hostname and a bounded public TXT excerpt only. No secrets, recipients, submissions, or full configuration are ever collected or shown.</li>
            <li>Each report belongs to your account only. Re-scans create new reports; old reports are never overwritten.</li>
          </ul>
          <p className="mt-3 text-sm text-slate-600">
            <a className="font-medium text-blue-700 underline" href="/tools/contact-email-checker/history">View your contact/email check history</a>
          </p>
        </section>
      </main>
    </Container>
  );
}
