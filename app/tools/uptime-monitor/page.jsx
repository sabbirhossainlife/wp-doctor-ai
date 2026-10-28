import { redirect } from "next/navigation";
import Container from "../../../components/Container";
import UptimeMonitorForm from "../../../components/UptimeMonitorForm";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";
import { getSchedulerHealth } from "../../../lib/uptime/service";

const STATE_LABELS = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  SUSPECTED_FAILURE: "Suspected failure",
  DOWN: "Down",
  RECOVERING: "Recovering",
  MAINTENANCE: "Maintenance",
  UNKNOWN: "Unknown",
  PAUSED: "Paused",
  BLOCKED: "Blocked",
};

export default async function UptimeMonitorPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [websites, monitors, health] = await Promise.all([
    prisma.website.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.websiteMonitor.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    getSchedulerHealth().catch(() => null),
  ]);
  const counts = monitors.reduce((acc, m) => {
    acc[m.currentState] = (acc[m.currentState] ?? 0) + 1;
    return acc;
  }, {});
  const openIncidents = await prisma.monitorIncident.count({
    where: { monitorId: { in: monitors.map((m) => m.id) }, status: "OPEN" },
  }).catch(() => 0);
  const schedulerActive = Boolean(health?.lastTickAt) && Date.now() - new Date(health.lastTickAt).getTime() < 2 * 60 * 60 * 1000;

  return (
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Uptime &amp; Maintenance Monitor</h1>
        <p className="mt-3 text-slate-600">
          Authenticated, single-location monitoring for your registered websites only. A check is one
          observed result from this monitoring location — never proof a site is down worldwide, never
          a guaranteed-uptime claim. HTTP 200 does not mean WordPress is fully functional, and a
          timeout is evidence of a failed check here, not absolute proof of a global outage. All
          checks run through the SSRF-safe pinned scanner; response bodies are never stored.
        </p>
        <section className={`mt-6 rounded-xl border p-6 ${schedulerActive ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`} aria-labelledby="scheduler-heading">
          <h2 id="scheduler-heading" className="text-lg font-semibold">Scheduled monitoring status</h2>
          {schedulerActive ? (
            <p className="mt-2 text-sm text-slate-700">
              Scheduled checks are running: the last scheduler tick was at {health.lastTickAt}. A tick alone does not
              prove future ticks will run — if ticks stop, monitors show a monitoring gap, not a false healthy state.
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-700">
              <strong>Scheduled monitoring inactive: worker not configured.</strong>{" "}
              Recurring checks require an external scheduler calling POST /api/monitoring/internal/tick with the
              server-only MONITORING_TICK_SECRET. Until a tick has actually run, only manual checks work, and this
              dashboard must not be read as continuous monitoring. {health?.lastTickAt ? `Last tick: ${health.lastTickAt}.` : "No tick has ever run."}
            </p>
          )}
          <p className="mt-2 text-sm text-slate-700">
            Email alerts: not configured (EMAIL_NOT_CONFIGURED). In-app notifications and history work without email.
            No multi-region observation is implemented — every result is from this single location.
          </p>
        </section>
        <section className="mt-6 grid gap-4 sm:grid-cols-4" aria-label="Monitor overview">
          <div className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Total monitors</p><p className="mt-1 text-2xl font-bold">{monitors.length} <span className="text-sm font-normal text-slate-500">/ 20 per account</span></p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Healthy</p><p className="mt-1 text-2xl font-bold">{counts.HEALTHY ?? 0}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Degraded / suspected</p><p className="mt-1 text-2xl font-bold">{(counts.DEGRADED ?? 0) + (counts.SUSPECTED_FAILURE ?? 0)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Open downtime incidents</p><p className="mt-1 text-2xl font-bold">{openIncidents}</p></div>
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="create-heading">
          <h2 id="create-heading" className="text-lg font-semibold">Create a monitor</h2>
          {websites.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">Register a website first (Dashboard), then return here. Monitors bind to registered websites only — there is no arbitrary-URL monitoring.</p>
          ) : (
            <div className="mt-4"><UptimeMonitorForm websites={websites.map((w) => ({ id: w.id, name: w.name, normalizedUrl: w.normalizedUrl }))} emailConfigured={health?.emailConfigured ?? false} /></div>
          )}
        </section>
        <section className="mt-6" aria-labelledby="list-heading">
          <h2 id="list-heading" className="text-lg font-semibold">Your monitors</h2>
          {monitors.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No monitors yet. Create one above.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {monitors.map((m) => (
                <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-5">
                  <a className="font-semibold text-blue-700 underline" href={`/tools/uptime-monitor/${m.id}`}>{m.targetUrl}</a>
                  <p className="mt-1 text-sm text-slate-600">
                    <span aria-label={`Status: ${STATE_LABELS[m.currentState] ?? m.currentState}`}>● {STATE_LABELS[m.currentState] ?? m.currentState}</span>
                    {" · "}every {m.checkIntervalMinutes} min
                    {" · "}{m.status === "PAUSED" ? "paused by you" : "enabled"}
                    {!m.targetConfirmed && " · target needs reconfirmation"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Last check: {m.lastCheckAt ? new Date(m.lastCheckAt).toLocaleString() : "never"}
                    {" · "}Last success: {m.lastSuccessAt ? new Date(m.lastSuccessAt).toLocaleString() : "never"}
                    {" · "}Next check: {m.nextCheckAt ? new Date(m.nextCheckAt).toLocaleString() : "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="limits-heading">
          <h2 id="limits-heading" className="text-lg font-semibold">What this monitor can and cannot do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Reachability is not application health: a 200 response does not prove WordPress, WooCommerce, or Elementor work correctly.</li>
            <li>401/403, 404, and 429 responses mean the server responded — they are reported as degraded, never as downtime by themselves.</li>
            <li>A 503 is a server error unless it carries a recognised WordPress maintenance signature; only then is it reported as an observed maintenance indicator.</li>
            <li>Cross-host redirects are never followed; the destination host is recorded, the destination is never fetched.</li>
            <li>Availability percentages use completed eligible checks only. Maintenance, blocked, unknown, and missing/paused periods are excluded from the denominator and shown separately — never counted as uptime.</li>
            <li>Check history is kept for 90 days. Pausing a monitor never deletes history; deleting a monitor deletes only that monitor's own checks, incidents, windows, and notifications.</li>
            <li>No AI is used by this tool. No webhooks, no multi-region checks, no recurring maintenance windows, and no email delivery are implemented in this milestone.</li>
          </ul>
        </section>
      </main>
    </Container>
  );
}
