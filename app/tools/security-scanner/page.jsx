import { redirect } from "next/navigation";
import PageContainer from "../../../components/PageContainer";
import PageHeader from "../../../components/PageHeader";
import SecurityScannerForm from "../../../components/SecurityScannerForm";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";

export default async function SecurityScannerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const websites = await prisma.website.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <PageContainer>
      <main className="py-12">
        <PageHeader title="Security & Vulnerability Scanner" backHref="/dashboard" backLabel="Back to dashboard">
        <p className="mt-3 text-slate-600">
          Read-only, evidence-based security diagnosis for a registered WordPress site:
          installed core, plugin, and theme versions are matched against advisories from
          WPVulnerability (keyless, open API), update status comes from the connector
          snapshot&apos;s cached metadata, hardening flags come from the connector&apos;s
          runtime-constant indicators (schema v6, plugin 1.5.0+), and public HTTP
          observations cover security headers, XML-RPC reachability, and a small fixed
          list of sensitive paths. Nothing is exploited, logged into, submitted, or
          changed — and no result here ever means a site is completely secure.
        </p>
        </PageHeader>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <SecurityScannerForm websites={websites.map((w) => ({ id: w.id, name: w.name, normalizedUrl: w.normalizedUrl }))} />
        </div>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="sec-limits-heading">
          <h2 id="sec-limits-heading" className="text-lg font-semibold">What this check can and cannot do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Results are separated into: (1) known advisory match, (2) outdated component, (3) observed hardening concern, (4) possible exposure requiring confirmation, (5) no matching advisory in the checked source, (6) not checked / insufficient evidence, (7) provider or network unavailable.</li>
            <li>A version-matched advisory is a potential vulnerability, not proof of exploitation. Exploitability is never tested.</li>
            <li>&quot;No matching advisory in the checked source&quot; means only that WPVulnerability returned no match for that component — other sources, unpublished issues, and configuration problems are not covered. It is never presented as &quot;100% Secure&quot;.</li>
            <li>Theme advisories are not matched by slug: the snapshot theme object carries a display name only, and names are never matched as identities. Theme identity is reported as uncertain.</li>
            <li>Outdated is not the same as vulnerable. A missing or weak security header is a hardening gap, not a confirmed vulnerability.</li>
            <li>Sensitive-path results: a 200 response with a matching file signature is a confirmed exposure classification (the body itself is discarded immediately and never stored or shown); a 200 without a signature is only a possible exposure; a 403/404 does not prove the file is absent.</li>
            <li>XML-RPC reachability is an observation only. Disabling XML-RPC is not automatically recommended — apps and integrations legitimately use it.</li>
            <li>Full scans require a registered website with a fresh (24-hour) connector snapshot. There is no URL-only full vulnerability scan.</li>
            <li>Each report belongs to your account only. Re-scans create new reports; old reports are never overwritten.</li>
          </ul>
          <p className="mt-3 text-sm text-slate-600">
            <a className="font-medium text-blue-700 underline" href="/tools/security-scanner/history">View your security scan history</a>
          </p>
        </section>
      </main>
    </PageContainer>
  );
}
