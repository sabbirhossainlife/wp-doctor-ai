import { redirect } from "next/navigation";
import PageContainer from "../../../../components/PageContainer";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";

const PAGE_SIZE = 20;

function categoryLabel(value) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default async function WooCommerceHistoryPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  let page = Number.parseInt(sp?.page ?? "1", 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  const [total, diagnostics] = await Promise.all([
    prisma.wooCommerceDiagnostic.count({ where: { userId: user.id } }),
    prisma.wooCommerceDiagnostic.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { website: true, _count: { select: { findings: true } } },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages) page = totalPages;

  return (
    <PageContainer>
      <main className="py-12">
        <h1 className="text-3xl font-bold">WooCommerce check history</h1>
        <p className="mt-2 text-slate-600">Real WooCommerce reports belonging to your account only.</p>
        {diagnostics.length === 0 ? (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-slate-700">
              No WooCommerce checks yet. Run your first check from the{" "}
              <a className="font-medium text-blue-700 underline" href="/tools/woocommerce-checkout-checker">
                WooCommerce Checkout &amp; Payment Checker
              </a>
              .
            </p>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {diagnostics.map((d) => (
              <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <a className="font-semibold text-blue-700 underline" href={`/tools/woocommerce-checkout-checker/${d.id}`}>
                  {d.website?.name ?? "Website"} — {categoryLabel(d.symptomCategory)}
                </a>
                <p className="mt-1 text-sm text-slate-600">
                  {d._count.findings} finding(s) · Snapshot v{d.snapshotSchemaVersion} · {new Date(d.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </PageContainer>
  );
}
