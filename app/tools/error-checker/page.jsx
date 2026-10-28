import { redirect } from "next/navigation";
import PageContainer from "../../../components/PageContainer";
import PageHeader from "../../../components/PageHeader";
import ScanForm from "../../../components/ScanForm";
import { getCurrentUser } from "../../../lib/session";

export default async function ErrorCheckerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <PageContainer>
      <main className="py-12">
        <PageHeader title="Website Error Checker" backHref="/dashboard" backLabel="Back to dashboard">
        <p className="mt-3 text-slate-600">
          Enter a public website URL. The checker runs a bounded, secure HTTP
          diagnostic — availability, HTTP status, redirects, and connection
          problems — and saves an evidence-based report you can review later.
          It does not diagnose private WordPress internals from a public URL.
        </p>
        </PageHeader>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <ScanForm />
        </div>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="privacy-heading">
          <h2 id="privacy-heading" className="text-lg font-semibold">Privacy and security</h2>
          <p className="mt-2 text-sm text-slate-600">
            Your URL is fetched as submitted (the query string is part of the
            HTTP request target, as it must be to fetch that URL), but query
            strings and fragments are never stored in scan history or logs —
            only the protocol, hostname, and path are kept. No response bodies,
            cookies, credentials, DNS answers, or internal IP addresses are
            stored. Only the standard web ports are accepted, and destinations
            that are not publicly reachable are rejected before any connection.
          </p>
          <p className="mt-3 text-sm">
            <a className="font-medium text-blue-700 underline" href="/tools/error-checker/history">
              View your scan history
            </a>
          </p>
        </section>
      </main>
    </PageContainer>
  );
}
