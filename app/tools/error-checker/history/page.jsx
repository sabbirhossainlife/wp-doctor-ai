import { redirect } from "next/navigation";
import PageContainer from "../../../../components/PageContainer";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";

const PAGE_SIZE = 20;

function outcomeLabel(outcome) {
  return outcome.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default async function ScanHistoryPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  let page = Number.parseInt(sp?.page ?? "1", 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  const [total, scans] = await Promise.all([
    prisma.scan.count({ where: { userId: user.id } }),
    prisma.scan.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages) page = totalPages;

  return (
    <PageContainer>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Scan history</h1>
        <p className="mt-2 text-slate-600">
          Real scan reports belonging to your account only.
        </p>
        {scans.length === 0 ? (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-slate-700">
              No scans yet. Run your first check from the{" "}
              <a className="font-medium text-blue-700 underline" href="/tools/error-checker">
                Website Error Checker
              </a>
              .
            </p>
          </div>
        ) : (
          <>
            <ul className="mt-8 space-y-3">
              {scans.map((scan) => (
                <li key={scan.id} className="rounded-xl border border-slate-200 bg-white p-5">
                  <a className="font-semibold text-blue-700 underline" href={`/tools/error-checker/${scan.id}`}>
                    {scan.targetUrl}
                  </a>
                  <p className="mt-1 text-sm text-slate-600">
                    {outcomeLabel(scan.diagnosticOutcome)}
                    {scan.httpStatus ? ` · HTTP ${scan.httpStatus}` : ""}
                    {scan.durationMs != null ? ` · ${scan.durationMs} ms` : ""}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {new Date(scan.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
            <nav className="mt-6 flex items-center gap-4 text-sm" aria-label="Scan history pages">
              {page > 1 && (
                <a className="font-medium text-blue-700 underline" href={`/tools/error-checker/history?page=${page - 1}`}>
                  Previous page
                </a>
              )}
              <span className="text-slate-600">
                Page {page} of {totalPages} ({total} scan{total === 1 ? "" : "s"})
              </span>
              {page < totalPages && (
                <a className="font-medium text-blue-700 underline" href={`/tools/error-checker/history?page=${page + 1}`}>
                  Next page
                </a>
              )}
            </nav>
          </>
        )}
      </main>
    </PageContainer>
  );
}
