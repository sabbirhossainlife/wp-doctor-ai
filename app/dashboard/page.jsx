import { redirect } from "next/navigation";
import PageContainer from "../../components/PageContainer";
import LogoutButton from "../../components/LogoutButton";
import WebsiteForm from "../../components/WebsiteForm";
import StatusIndicator from "../../components/StatusIndicator";
import ToolCard from "../../components/ToolCard";
import ResponsiveGrid from "../../components/ResponsiveGrid";
import { getCurrentUser } from "../../lib/session";
import { prisma } from "../../lib/prisma";
import { getSchedulerHealth } from "../../lib/uptime/service";
import { TOOL_CATEGORIES } from "../../lib/tools-nav";

// Real dashboard: only data this account already owns — websites, scans,
// monitors, incidents, and scheduler health. No fabricated metrics.
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
  const monitors = await prisma.websiteMonitor
    .findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 })
    .catch(() => []);
  const openIncidents = await prisma.monitorIncident
    .count({ where: { monitorId: { in: monitors.map((m) => m.id) }, status: "OPEN" } })
    .catch(() => 0);
  const health = await getSchedulerHealth().catch(() => null);
  const schedulerActive =
    Boolean(health?.lastTickAt) &&
    Date.now() - new Date(health.lastTickAt).getTime() < 2 * 60 * 60 * 1000;

  return (
    <PageContainer>
      <main className="py-12">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-balance text-3xl font-bold text-ink sm:text-4xl">
              Welcome, {user.name}
            </h1>
            <p className="mt-2 min-w-0 break-words text-ink-secondary">
              {user.email} · Account role: {user.role ?? "USER"}
            </p>
          </div>
          <LogoutButton className="flex min-h-[44px] items-center rounded-lg border border-border px-4 py-2 text-sm font-medium" />
        </div>

        <div className="mt-10 grid min-w-0 items-start gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <section
              className="rounded-xl border border-border bg-surface p-6 shadow-sm"
              aria-labelledby="websites-heading"
            >
              <h2 id="websites-heading" className="text-xl font-semibold text-ink">
                Your websites ({websites.length})
              </h2>
              {websites.length === 0 ? (
                <div className="mt-4 rounded-lg border border-border bg-paper p-5">
                  <p className="text-ink-secondary">
                    No websites registered yet. Add your first website below — it will be
                    marked <strong>not connected</strong> until the WordPress connector
                    (plugin 1.7.0) actually pairs it. After pairing, open a website from
                    the list to find its connector pairing instructions, then the 12
                    diagnostic tools can run against that site.
                  </p>
                </div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {websites.map((w) => (
                    <li
                      key={w.id}
                      className="min-w-0 rounded-lg border border-border bg-paper p-4"
                    >
                      <a
                        className="min-w-0 break-words font-semibold text-accent underline underline-offset-4 hover:text-accent-hover"
                        href={`/dashboard/websites/${w.id}`}
                      >
                        {w.name}
                      </a>
                      <p className="mt-1 min-w-0 break-words text-sm text-ink-secondary">
                        {w.normalizedUrl}
                      </p>
                      <p className="mt-1 text-sm text-ink-secondary">
                        Connection:{" "}
                        {w.connectionStatus === "NOT_CONNECTED"
                          ? "Not connected"
                          : w.connectionStatus}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-6 rounded-lg border border-border bg-paper p-5">
                <h3 className="font-semibold text-ink">Add a website</h3>
                <div className="mt-4">
                  <WebsiteForm />
                </div>
              </div>
            </section>

            <section
              className="rounded-xl border border-border bg-surface p-6 shadow-sm"
              aria-labelledby="scans-heading"
            >
              <h2 id="scans-heading" className="text-xl font-semibold text-ink">
                Recent diagnostic reports
              </h2>
              <p className="mt-2 text-sm">
                <a
                  className="font-medium text-accent underline underline-offset-4"
                  href="/tools/error-checker"
                >
                  Run a website error check
                </a>
                {" · "}
                <a
                  className="font-medium text-accent underline underline-offset-4"
                  href="/tools/error-checker/history"
                >
                  View full scan history
                </a>
              </p>
              {recentScans.length === 0 ? (
                <p className="mt-3 text-ink-secondary">
                  No scans yet. Run your first check above — completed checks will appear
                  here.
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {recentScans.map((scan) => (
                    <li key={scan.id} className="min-w-0 text-sm">
                      <a
                        className="min-w-0 break-words font-medium text-accent underline underline-offset-4"
                        href={`/tools/error-checker/${scan.id}`}
                      >
                        {scan.targetUrl}
                      </a>
                      <span className="text-ink-secondary">
                        {" "}· {scan.diagnosticOutcome.replaceAll("_", " ").toLowerCase()}
                        {scan.httpStatus ? ` · HTTP ${scan.httpStatus}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              className="rounded-xl border border-border bg-surface p-6 shadow-sm"
              aria-labelledby="repair-heading"
            >
              <h2 id="repair-heading" className="text-xl font-semibold text-ink">
                Repair requests — coming later
              </h2>
              <p className="mt-2 text-ink-secondary">
                The expert repair workflow is a later milestone and is not available yet. No
                repair tickets exist.
              </p>
            </section>
          </div>

          <aside className="min-w-0 space-y-6">
            <section
              className="rounded-xl border border-border bg-surface p-6 shadow-sm"
              aria-labelledby="quick-heading"
            >
              <h2 id="quick-heading" className="text-lg font-semibold text-ink">
                Quick actions
              </h2>
              <ul className="mt-3 space-y-1">
                <li>
                  <a
                    href="/tools/error-checker"
                    className="flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
                  >
                    Run an error check →
                  </a>
                </li>
                <li>
                  <a
                    href="/tools/security-scanner"
                    className="flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
                  >
                    Run a security scan →
                  </a>
                </li>
                <li>
                  <a
                    href="/tools/uptime-monitor"
                    className="flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
                  >
                    Manage uptime monitors →
                  </a>
                </li>
              </ul>
            </section>

            <section
              className="rounded-xl border border-border bg-surface p-6 shadow-sm"
              aria-labelledby="monitoring-heading"
            >
              <h2 id="monitoring-heading" className="text-lg font-semibold text-ink">
                Monitoring status
              </h2>
              <dl className="mt-3 space-y-2 text-sm text-ink-secondary">
                <div className="flex justify-between gap-2">
                  <dt>Monitors</dt>
                  <dd className="font-semibold text-ink">{monitors.length}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Open downtime incidents</dt>
                  <dd className="font-semibold text-ink">{openIncidents}</dd>
                </div>
              </dl>
              <div className="mt-3">
                {schedulerActive ? (
                  <StatusIndicator status="running" label="Scheduled monitoring active" />
                ) : (
                  <StatusIndicator
                    status="scheduler-inactive"
                    label="Scheduled monitoring inactive: worker not configured."
                  />
                )}
              </div>
              {!schedulerActive ? (
                <p className="mt-2 text-sm text-ink-secondary">
                  Recurring checks require an external scheduler calling the tick endpoint.
                  Until a tick has actually run, only manual checks work.
                </p>
              ) : null}
              <p className="mt-3 text-sm">
                <a
                  className="font-medium text-accent underline underline-offset-4"
                  href="/tools/uptime-monitor"
                >
                  Open the uptime monitor
                </a>
              </p>
            </section>

            <section
              className="rounded-xl border border-warning/40 bg-amber-50 p-6"
              aria-labelledby="config-heading"
            >
              <h2 id="config-heading" className="text-lg font-semibold text-ink">
                Configuration notices
              </h2>
              <ul className="mt-2 space-y-2 text-sm text-ink-secondary">
                <li className="flex min-w-0 gap-2">
                  <StatusIndicator status="not-configured" label="AI not configured" />
                </li>
                <li className="flex min-w-0 gap-2">
                  <StatusIndicator status="not-configured" label="Email not configured" />
                </li>
                <li className="flex min-w-0 gap-2">
                  <StatusIndicator status="not-configured" label="Search Console not connected" />
                </li>
              </ul>
              <p className="mt-3 text-sm text-ink-secondary">
                AI explanations, email alerts, and real indexing status are therefore
                unavailable. Nothing is faked in their place.
              </p>
            </section>

            <section
              className="rounded-xl border border-border bg-surface p-6 shadow-sm"
              aria-labelledby="settings-heading"
            >
              <h2 id="settings-heading" className="text-lg font-semibold text-ink">
                Account settings
              </h2>
              <p className="mt-2 min-w-0 break-words text-ink-secondary">
                Name: {user.name} · Email: {user.email} · Email verified:{" "}
                {user.emailVerified
                  ? "Yes"
                  : "Not yet — email verification is not configured (no email provider)."}
              </p>
              <p className="mt-2 text-sm text-ink-secondary">
                Role changes are not available here: roles are server-controlled and only
                ever assigned by administrators in a later milestone.
              </p>
            </section>
          </aside>
        </div>

        <section className="mt-12" aria-labelledby="dash-tools-heading">
          <h2 id="dash-tools-heading" className="text-xl font-semibold text-ink">
            Tool categories
          </h2>
          {TOOL_CATEGORIES.map((category) => (
            <section key={category.id} className="mt-6" aria-labelledby={`dash-${category.id}`}>
              <h3 id={`dash-${category.id}`} className="text-base font-semibold text-ink">
                {category.label}
              </h3>
              <ResponsiveGrid compact className="mt-3">
                {category.tools.map((tool) => (
                  <ToolCard key={tool.href} tool={tool} />
                ))}
              </ResponsiveGrid>
            </section>
          ))}
        </section>
      </main>
    </PageContainer>
  );
}
