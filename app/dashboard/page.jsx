import { redirect } from "next/navigation";
import Container from "../../components/Container";
import LogoutButton from "../../components/LogoutButton";
import WebsiteForm from "../../components/WebsiteForm";
import { getCurrentUser } from "../../lib/session";
import { prisma } from "../../lib/prisma";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const websites = await prisma.website.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const recentScans = await prisma.scan.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return (
    <Container>
      <main className="py-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Welcome, {user.name}</h1>
            <p className="mt-2 text-slate-600">
              {user.email} · Account role: {user.role ?? "USER"}
            </p>
          </div>
          <LogoutButton />
        </div>

        <section className="mt-10" aria-labelledby="websites-heading">
          <h2 id="websites-heading" className="text-2xl font-semibold">
            Your websites ({websites.length})
          </h2>
          {websites.length === 0 ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6">
              <p className="text-slate-700">
                No websites registered yet. Add your first website below — it
                will be marked <strong>not connected</strong> until the
                WordPress connector (plugin 1.7.0) actually pairs it. After
                pairing, the 12 diagnostic tools can run against that site.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {websites.map((w) => (
                <li key={w.id} className="rounded-xl border border-slate-200 bg-white p-5">
                  <a className="font-semibold text-blue-700 underline" href={`/dashboard/websites/${w.id}`}>
                    {w.name}
                  </a>
                  <p className="mt-1 text-sm text-slate-600">{w.normalizedUrl}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Connection: {w.connectionStatus === "NOT_CONNECTED" ? "Not connected" : w.connectionStatus}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-semibold">Add a website</h3>
            <div className="mt-4">
              <WebsiteForm />
            </div>
          </div>
        </section>

        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="scans-heading">
          <h2 id="scans-heading" className="text-xl font-semibold">Scan history</h2>
          <p className="mt-2">
            <a className="font-medium text-blue-700 underline" href="/tools/error-checker">
              Run a website error check
            </a>
            {" · "}
            <a className="font-medium text-blue-700 underline" href="/tools/error-checker/history">
              View full scan history
            </a>
          </p>
          {recentScans.length === 0 ? (
            <p className="mt-3 text-slate-600">
              No scans yet. Your completed checks will appear here.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {recentScans.map((scan) => (
                <li key={scan.id} className="text-sm">
                  <a className="font-medium text-blue-700 underline" href={`/tools/error-checker/${scan.id}`}>
                    {scan.targetUrl}
                  </a>
                  <span className="text-slate-600">
                    {" "}· {scan.diagnosticOutcome.replaceAll("_", " ").toLowerCase()}
                    {scan.httpStatus ? ` · HTTP ${scan.httpStatus}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="repair-heading">
          <h2 id="repair-heading" className="text-xl font-semibold">Repair requests — coming later</h2>
          <p className="mt-2 text-slate-600">
            The expert repair workflow is a later milestone and is not available
            yet. No repair tickets exist.
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="settings-heading">
          <h2 id="settings-heading" className="text-xl font-semibold">Account settings</h2>
          <p className="mt-2 text-slate-600">
            Name: {user.name} · Email: {user.email} · Email verified:{" "}
            {user.emailVerified ? "Yes" : "Not yet — email verification is not configured (no email provider)."}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Role changes are not available here: roles are server-controlled
            and only ever assigned by administrators in a later milestone.
          </p>
        </section>
      </main>
    </Container>
  );
}
