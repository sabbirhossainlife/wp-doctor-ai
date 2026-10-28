import { redirect } from "next/navigation";
import PageContainer from "../../../../components/PageContainer";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";

const PAGE_SIZE = 20;

export default async function SpeedHistoryPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  let page = Number.parseInt(sp?.page ?? "1", 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  const [total, diagnostics] = await Promise.all([
    prisma.speedDiagnostic.count({ where: { userId: user.id } }),
    prisma.speedDiagnostic.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { findings: true } } },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages) page = totalPages;

  return (
    <PageContainer>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Speed check history</h1>
        <p className="mt-2 text-slate-600">Real speed reports belonging to your account only. Re-scans create new reports; old reports are never overwritten.</p>
        {diagnostics.length === 0 ? (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-slate-700">
              No speed checks yet. Run your first check from the{" "}
              <a className="font-medium text-blue-700 underline" href="/tools/website-speed-analyzer">
                Website Speed Analyzer
              </a>
              .
            </p>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {diagnostics.map((d) => (
              <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <a className="font-semibold text-blue-700 underline" href={`/tools/website-speed-analyzer/${d.id}`}>
                  {d.providerTarget ?? d.requestedTarget} — {d.strategy} — {d.status}
                </a>
                <p className="mt-1 text-sm text-slate-600">
                  {d._count.findings} finding(s) · Lighthouse {d.lighthouseSummary?.score100 ?? "unavailable"} · {new Date(d.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
        {totalPages > 1 ? (
          <p className="mt-6 text-sm text-slate-600">
            Page {page} of {totalPages} · {total} report(s) total.
            {page > 1 ? <a className="ml-3 font-medium text-blue-700 underline" href={`/tools/website-speed-analyzer/history?page=${page - 1}`}>Previous</a> : null}
            {page < totalPages ? <a className="ml-3 font-medium text-blue-700 underline" href={`/tools/website-speed-analyzer/history?page=${page + 1}`}>Next</a> : null}
          </p>
        ) : null}
      </main>
    </PageContainer>
  );
}
