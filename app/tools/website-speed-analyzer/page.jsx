import { redirect } from "next/navigation";
import PageContainer from "../../../components/PageContainer";
import PageHeader from "../../../components/PageHeader";
import SpeedAnalyzerForm from "../../../components/SpeedAnalyzerForm";
import { getCurrentUser } from "../../../lib/session";

export default async function SpeedAnalyzerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <PageContainer>
      <main className="py-12">
        <PageHeader title="Website Speed Analyzer" backHref="/dashboard" backLabel="Back to dashboard">
        <p className="mt-3 text-slate-600">
          Diagnoses one page from three separate sources, kept separate on purpose:
          a basic HTTP preflight (status, redirects, total response time), a Google
          Lighthouse lab run (simulated device and network), and Chrome UX Report
          field data (real-user 75th percentiles). Lab and field are never merged into
          a combined score, lab Total Blocking Time is never reported as field INP,
          and the Lighthouse score is a lab score — never a Google ranking score.
          Nothing on the analysed site is changed: this tool diagnoses only.
        </p>
        </PageHeader>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <SpeedAnalyzerForm />
        </div>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="speed-limits-heading">
          <h2 id="speed-limits-heading" className="text-lg font-semibold">What this check can and cannot do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Good targets: LCP ≤ 2.5 s, INP &lt; 200 ms, CLS &lt; 0.1 (field: 75th percentile; lab: Lighthouse value, labelled LAB).</li>
            <li>Field data is unavailable for many pages — low-traffic pages often have no CrUX record. Unavailable is shown as UNAVAILABLE, never zero and never a green success.</li>
            <li>Lab and field disagreement is normal: different devices, networks, and time windows. It is not an error.</li>
            <li>Provider access is not unlimited: PageSpeed Insights and CrUX quotas are Google-side. If a provider is not configured, the report still shows the sources that did succeed (status PARTIAL).</li>
            <li>Each report belongs to your account only. There is no shared cross-user cache.</li>
            <li>Local addresses (for example a development site on localhost) are blocked by design — Google cannot analyse a page it cannot reach, and the preflight rejects private destinations.</li>
          </ul>
          <p className="mt-3 text-sm text-slate-600">
            <a className="font-medium text-blue-700 underline" href="/tools/website-speed-analyzer/history">View your speed history</a>
          </p>
        </section>
      </main>
    </PageContainer>
  );
}
