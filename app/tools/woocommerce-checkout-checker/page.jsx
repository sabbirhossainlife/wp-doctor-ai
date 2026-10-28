import { redirect } from "next/navigation";
import PageContainer from "../../../components/PageContainer";
import PageHeader from "../../../components/PageHeader";
import WooCommerceCheckerForm from "../../../components/WooCommerceCheckerForm";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";
import { wooSnapshotFreshness } from "../../../lib/woocommerce/freshness";

export default async function WooCommerceCheckerPage() {
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
    const freshness = wooSnapshotFreshness(latest);
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
        <PageHeader title="WooCommerce Checkout & Payment Checker" backHref="/dashboard" backLabel="Back to dashboard">
        <p className="mt-3 text-slate-600">
          Checks the last diagnostic snapshot your WordPress connector sent
          for WooCommerce presence, checkout page configuration, and payment
          gateway setup — deterministically, with no guessing. The live site
          is not modified, no order is inspected, and no payment is ever run.
        </p>
        </PageHeader>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <WooCommerceCheckerForm websites={view} />
        </div>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="checker-privacy-heading">
          <h2 id="checker-privacy-heading" className="text-lg font-semibold">What this check can and cannot do</h2>
          <p className="mt-2 text-sm text-slate-600">
            It compares the store configuration in your snapshot against
            WooCommerce&apos;s documented requirements: distinct published pages
            for Cart, Checkout, and My Account, at least one enabled gateway,
            and declared Checkout block compatibility. An enabled gateway does
            not prove a payment will succeed, and a configured checkout page
            does not prove a real checkout works. It cannot confirm whether a
            payment succeeded, failed, or is pending — orders and transactions
            are never inspected. Snapshots older than 24 hours are treated as
            stale: re-sync from the connector admin page in WordPress first.
            Safe next steps are described for you to perform manually — never
            executed by this app.
          </p>
          <p className="mt-3 text-sm">
            <a className="font-medium text-blue-700 underline" href="/tools/woocommerce-checkout-checker/history">
              View your WooCommerce check history
            </a>
          </p>
        </section>
      </main>
    </PageContainer>
  );
}
