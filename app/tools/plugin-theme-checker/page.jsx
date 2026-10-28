import { redirect } from "next/navigation";
import PageContainer from "../../../components/PageContainer";
import PageHeader from "../../../components/PageHeader";
import ConflictCheckerForm from "../../../components/ConflictCheckerForm";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";
import { snapshotFreshness } from "../../../lib/conflict/freshness";

export default async function PluginThemeCheckerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const websites = await prisma.website.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      connection: { include: { snapshots: { orderBy: { receivedAt: "desc" }, take: 1 } } },
    },
  });
  const view = websites.map((w) => {
    const latest = w.connection?.snapshots?.[0] ?? null;
    const freshness = snapshotFreshness(latest);
    return {
      id: w.id,
      name: w.name,
      normalizedUrl: w.normalizedUrl,
      connectionStatus: w.connectionStatus,
      snapshotStatus: freshness.status,
      snapshotReceivedAt: freshness.receivedAt ? freshness.receivedAt.toISOString() : null,
    };
  });
  return (
    <PageContainer>
      <main className="py-12">
        <PageHeader title="Plugin & Theme Conflict Checker" backHref="/dashboard" backLabel="Back to dashboard">
        <p className="mt-3 text-slate-600">
          Checks the last diagnostic snapshot your WordPress connector sent
          for PHP/WordPress requirement mismatches, declared plugin
          dependencies, and available updates — deterministically, with no
          guessing. The live site is not modified: nothing is deactivated,
          switched, or changed.
        </p>
        </PageHeader>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <ConflictCheckerForm websites={view} />
        </div>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="checker-privacy-heading">
          <h2 id="checker-privacy-heading" className="text-lg font-semibold">What this check can and cannot do</h2>
          <p className="mt-2 text-sm text-slate-600">
            It compares declared requirements against the versions in your
            snapshot and reports what is missing. It cannot prove that a
            plugin caused a symptom, and a symptom that appeared after an
            update does not prove the update caused it. Snapshots older than
            24 hours are treated as stale: re-sync from the connector admin
            page in WordPress first. Safe next steps are described for you to
            perform manually — including staging isolation with a backup —
            never executed by this app.
          </p>
          <p className="mt-3 text-sm">
            <a className="font-medium text-blue-700 underline" href="/tools/plugin-theme-checker/history">
              View your conflict check history
            </a>
          </p>
        </section>
      </main>
    </PageContainer>
  );
}
