import { redirect } from "next/navigation";
import PageContainer from "../../../../components/PageContainer";
import UptimeMonitorActions from "../../../../components/UptimeMonitorActions";
import MaintenanceWindowForm from "../../../../components/MaintenanceWindowForm";
import { getCurrentUser } from "../../../../lib/session";
import { getMonitorDetail, availabilityForMonitor } from "../../../../lib/uptime/service";

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

export default async function UptimeMonitorDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  let detail;
  let availability;
  try {
    detail = await getMonitorDetail(user.id, id);
    availability = await availabilityForMonitor(user.id, id, 7);
  } catch {
    redirect("/tools/uptime-monitor");
  }
  const { monitor, website, checks, incidents, windows, notifications } = detail;
  const now = Date.now();
  const activeWindows = windows.filter((w) => w.status === "ACTIVE" && new Date(w.startAt).getTime() <= now && now < new Date(w.endAt).getTime());

  return (
    <PageContainer>
      <main className="py-12">
        <a className="text-sm font-medium text-blue-700 underline" href="/tools/uptime-monitor">← All monitors</a>
        <h1 className="mt-4 text-3xl font-bold">{monitor.targetUrl}</h1>
        <p className="mt-2 text-slate-600">
          <span aria-label={`Status: ${STATE_LABELS[monitor.currentState] ?? monitor.currentState}`}>● {STATE_LABELS[monitor.currentState] ?? monitor.currentState}</span>
          {" · "}Registered website: {website ? website.name : "—"}
          {" · "}Every {monitor.checkIntervalMinutes} minutes
          {" · "}Failure threshold: {monitor.failureThreshold} · Recovery threshold: {monitor.recoveryThreshold}
        </p>
        {!monitor.targetConfirmed && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            <strong>Target needs reconfirmation.</strong> The registered website URL changed after this monitor was
            configured. Checks are blocked until you explicitly reconfirm the new target below — the monitor will
            never silently switch to a different destination.
          </p>
        )}
        {activeWindows.length > 0 && (
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700" role="status">
            <strong>Scheduled maintenance active:</strong> {activeWindows.map((w) => w.title).join(", ")} — this is a
            user-scheduled window, distinct from an observed WordPress maintenance page. Notifications follow the
            window&apos;s suppression policy; check history is still recorded unless the window pauses checks.
          </p>
        )}
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="actions-heading">
          <h2 id="actions-heading" className="text-lg font-semibold">Actions</h2>
          <div className="mt-4"><UptimeMonitorActions monitor={monitor} /></div>
          <p className="mt-3 text-sm text-slate-500">Manual checks are rate-limited (30 per hour per account) and share the same scanner policy as scheduled checks.</p>
        </section>
        <section className="mt-6 grid gap-4 sm:grid-cols-3" aria-label="Availability summary">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Availability, last 7 days</p>
            <p className="mt-1 text-2xl font-bold">{availability.availability.availabilityPercent === null ? "No eligible checks" : `${availability.availability.availabilityPercent}%`}</p>
            <p className="mt-1 text-sm text-slate-500">{availability.availability.eligibleCount} eligible checks · {availability.availability.maintenanceCount} maintenance · {availability.availability.blockedCount} blocked · {availability.availability.unknownCount} unknown (excluded from the denominator)</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Response time (successful checks)</p>
            <p className="mt-1 text-2xl font-bold">{availability.responseTime.averageMs === null ? "Insufficient data" : `${availability.responseTime.averageMs} ms avg`}</p>
            <p className="mt-1 text-sm text-slate-500">{availability.responseTime.count} successful observations{availability.responseTime.p50Ms !== null && ` · p50 ${availability.responseTime.p50Ms} ms · p95 ${availability.responseTime.p95Ms} ms`}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Last check / last success</p>
            <p className="mt-1 text-sm font-medium">{monitor.lastCheckAt ? new Date(monitor.lastCheckAt).toLocaleString() : "never"}</p>
            <p className="mt-1 text-sm text-slate-500">Last success: {monitor.lastSuccessAt ? new Date(monitor.lastSuccessAt).toLocaleString() : "never"}</p>
            <p className="mt-1 text-sm text-slate-500">Next check: {monitor.nextCheckAt ? new Date(monitor.nextCheckAt).toLocaleString() : "—"}</p>
          </div>
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="incidents-heading">
          <h2 id="incidents-heading" className="text-lg font-semibold">Incident timeline</h2>
          {incidents.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No downtime incidents recorded. A single failed check never opens an incident — it takes {monitor.failureThreshold} consecutive failures.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {incidents.map((inc) => (
                <li key={inc.id} className="border-b border-slate-100 pb-3 text-sm">
                  <p><strong>{inc.status === "OPEN" ? "Open downtime incident" : "Recovered incident"}</strong> · first failure {new Date(inc.firstFailureAt).toLocaleString()} · confirmed {new Date(inc.confirmedAt).toLocaleString()}{inc.recoveredAt ? ` · recovery detected ${new Date(inc.recoveredAt).toLocaleString()}` : ""}</p>
                  <p className="text-slate-600">Failures: {inc.failureCount} · reason: {inc.failureReason ?? "—"} · observed duration is confirmed → recovery-detected, not an exact outage window.</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="checks-heading">
          <h2 id="checks-heading" className="text-lg font-semibold">Recent checks</h2>
          {checks.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No checks yet. Run a manual check above, or wait for the scheduler tick.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {checks.slice(0, 20).map((c) => (
                <li key={c.id} className="text-sm">
                  <span aria-label={`Outcome: ${c.outcome}`}>● {c.outcome}</span>
                  {c.httpStatus ? ` · HTTP ${c.httpStatus}` : ""}{typeof c.latencyMs === "number" ? ` · ${c.latencyMs} ms` : ""}
                  {c.latencyWarning ? " · latency warning" : ""}{c.failureReason ? ` · ${c.failureReason}` : ""}
                  {c.monitoringGap ? " · monitoring gap before this check" : ""}
                  {c.maintenanceIndicator === "OBSERVED" ? " · WP maintenance indicator observed" : ""}
                  {` · ${new Date(c.startedAt).toLocaleString()} · ${c.triggeredBy.toLowerCase()}`}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-slate-500">Response bodies are never stored; only status, latency, final URL (no query), redirect count, and outcome are kept.</p>
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="windows-heading">
          <h2 id="windows-heading" className="text-lg font-semibold">Maintenance windows</h2>
          {windows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No scheduled windows. A detected WordPress maintenance page never creates a schedule on its own.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {windows.map((w) => (
                <li key={w.id} className="text-sm">
                  <strong>{w.title}</strong> · {new Date(w.startAt).toLocaleString()} → {new Date(w.endAt).toLocaleString()} ({w.timezone}) · {w.status.toLowerCase()}
                  {w.suppressAlerts ? " · alerts suppressed" : " · alerts not suppressed"}{w.pauseChecks ? " · checks paused" : " · checks continue"}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 border-t border-slate-100 pt-6">
            <h3 className="font-semibold">Schedule a one-time window</h3>
            <div className="mt-4"><MaintenanceWindowForm monitorId={monitor.id} /></div>
          </div>
        </section>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="notifications-heading">
          <h2 id="notifications-heading" className="text-lg font-semibold">Notifications</h2>
          {notifications.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No notifications yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {notifications.map((n) => (
                <li key={n.id} className="text-sm">
                  <strong>{n.title}</strong> · {n.type} · {n.status.toLowerCase()}
                  {n.emailStatus ? ` · email: ${n.emailStatus}` : ""} · {new Date(n.createdAt).toLocaleString()}
                  <p className="text-slate-600">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </PageContainer>
  );
}
