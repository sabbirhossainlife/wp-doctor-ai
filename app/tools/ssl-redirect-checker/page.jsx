import { redirect } from "next/navigation";
import Container from "../../../components/Container";
import SslRedirectCheckerForm from "../../../components/SslRedirectCheckerForm";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";

export default async function SslRedirectCheckerPage() {
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
        <h1 className="text-3xl font-bold">SSL &amp; Redirect Checker</h1>
        <p className="mt-3 text-slate-600">
          Diagnoses one site&apos;s TLS certificate and redirect chain, separately and
          honestly: the certificate is verified for real (hostname, validity period,
          trusted chain) and every redirect hop is followed manually, revalidated
          against the safety policy before connecting. A downgrade from HTTPS to
          HTTP is recorded and blocked, never followed. A cross-host redirect is
          reported neutrally — it is not, on its own, evidence of anything
          malicious. Nothing on the analysed site is changed: this tool diagnoses only.
        </p>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <SslRedirectCheckerForm websites={websites.map((w) => ({ id: w.id, name: w.name, normalizedUrl: w.normalizedUrl }))} />
        </div>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="ssl-limits-heading">
          <h2 id="ssl-limits-heading" className="text-lg font-semibold">What this check can and cannot do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Certificate details (issuer, validity dates) are shown only when the handshake verified. An unverified certificate contributes only an error code — its details are never presented as verified.</li>
            <li>Expiry warning threshold: a verified certificate with 30 days or fewer remaining is flagged as expiring soon. Expiring soon is not expired.</li>
            <li>Redirect chain limited to 5 hops; loops and over-long chains stop the check (status PARTIAL) instead of running forever.</li>
            <li>Execution status is separate from findings: an expired certificate still yields a COMPLETED report with findings; BLOCKED means the target was rejected by the safety policy before any connection.</li>
            <li>Local addresses (for example a development site on localhost) are blocked by design.</li>
            <li>Each report belongs to your account only. Re-scans create new reports; old reports are never overwritten.</li>
          </ul>
          <p className="mt-3 text-sm text-slate-600">
            <a className="font-medium text-blue-700 underline" href="/tools/ssl-redirect-checker/history">View your SSL check history</a>
          </p>
        </section>
      </main>
    </Container>
  );
}
