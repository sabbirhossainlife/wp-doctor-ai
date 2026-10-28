import { redirect } from "next/navigation";
import Container from "../../../components/Container";
import ElementorCheckerForm from "../../../components/ElementorCheckerForm";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";
import { elementorSnapshotFreshness } from "../../../lib/elementor/freshness";

export default async function ElementorCheckerPage() {
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
    const freshness = elementorSnapshotFreshness(latest);
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
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Elementor &amp; Layout Checker</h1>
        <p className="mt-3 text-slate-600">
          Checks the last diagnostic snapshot your WordPress connector sent
          for Elementor presence, Elementor Pro status, declared version
          requirements, configured memory limits, and WordPress URL
          configuration — deterministically, with no guessing. The live site
          is not modified, nothing is deactivated or switched, no page is
          rendered, and no screenshot is analysed.
        </p>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <ElementorCheckerForm websites={view} />
        </div>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="checker-privacy-heading">
          <h2 id="checker-privacy-heading" className="text-lg font-semibold">What this check can and cannot do</h2>
          <p className="mt-2 text-sm text-slate-600">
            It compares the site configuration in your snapshot against
            Elementor&apos;s documented guidance: Elementor present and active,
            Pro status, declared PHP/WordPress requirements, configured memory
            against the documented 256 MB recommendation band, and matching
            WordPress/Site URL protocol and hostname. Installed Elementor does
            not prove the editor or layout works. It cannot verify a frontend
            layout visually — no rendering test exists and no screenshot is
            analysed, so visual condition is explicitly unverified. It cannot
            verify a browser console error — no console data is collected.
            Snapshots older than 24 hours are treated as stale: re-sync from
            the connector admin page in WordPress first. Safe next steps are
            described for you to perform manually — never executed by this app.
            Visual diagnosis here is based on your reported symptoms plus
            technical evidence, not image analysis.
          </p>
          <p className="mt-3 text-sm">
            <a className="font-medium text-blue-700 underline" href="/tools/elementor-layout-checker/history">
              View your Elementor check history
            </a>
          </p>
        </section>
      </main>
    </Container>
  );
}
