import { redirect } from "next/navigation";
import PageContainer from "../../../../components/PageContainer";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";

export default async function SecurityHistoryPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  let page = Number.parseInt(params?.page ?? "1", 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  const pageSize = 20;
  const [total, rows] = await Promise.all([
    prisma.securityDiagnostic.count({ where: { userId: user.id } }),
    prisma.securityDiagnostic.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { findings: { orderBy: { createdAt: "asc" } } },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <PageContainer>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Security scan history</h1>
        <p className="mt-2 text-slate-600">{total} report(s). Reports are immutable; re-scans create new reports.</p>
        {rows.length === 0 ? (
          <p className="mt-6 text-slate-600">No security reports yet. Run a scan from the <a className="font-medium text-blue-700 underline" href="/tools/security-scanner">Security &amp; Vulnerability Scanner</a>.</p>
        ) : (
          <ul className="mt-6 space-y-4">
            {rows.map((d) => (
              <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-6">
                <p className="text-sm text-slate-700">
                  <a className="font-medium text-blue-700 underline" href={`/tools/security-scanner/${d.id}`}>
                    {d.sanitizedWebsiteUrl}
                  </a>
                  {" · "}{d.executionStatus}{" · "}{new Date(d.createdAt).toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {d.findings.length} finding(s): {d.findings.map((f) => f.code).join(", ") || "none"}
                </p>
              </li>
            ))}
          </ul>
        )}
        <nav className="mt-6 flex gap-4 text-sm" aria-label="History pages">
          {page > 1 ? <a className="font-medium text-blue-700 underline" href={`/tools/security-scanner/history?page=${page - 1}`}>Previous page</a> : null}
          {page < totalPages ? <a className="font-medium text-blue-700 underline" href={`/tools/security-scanner/history?page=${page + 1}`}>Next page</a> : null}
        </nav>
      </main>
    </PageContainer>
  );
}
