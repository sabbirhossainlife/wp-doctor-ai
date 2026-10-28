import { redirect, notFound } from "next/navigation";
import Container from "../../../../components/Container";
import SecurityAiSection from "../../../../components/SecurityAiSection";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";
import { publicSecurityAnalysis } from "../../../../lib/security/ai";

export default async function SecurityDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const diagnostic = await prisma.securityDiagnostic.findFirst({
    where: { id, userId: user.id },
    include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
  });
  if (!diagnostic) notFound();

  const inv = diagnostic.componentInventorySummary && typeof diagnostic.componentInventorySummary === "object" ? diagnostic.componentInventorySummary : {};
  const adv = diagnostic.advisoryMatchSummary && typeof diagnostic.advisoryMatchSummary === "object" ? diagnostic.advisoryMatchSummary : {};
  const http = diagnostic.httpObservations && typeof diagnostic.httpObservations === "object" ? diagnostic.httpObservations : {};
  const providers = Array.isArray(diagnostic.providerStatuses) ? diagnostic.providerStatuses : [];
  const limitations = Array.isArray(diagnostic.limitations) ? diagnostic.limitations : [];

  const isAdvisory = (f) => f.code.endsWith("_KNOWN_VULNERABILITY");
  const isOutdated = (f) => f.code === "COMPONENT_OUTDATED";
  const isExposure = (f) => f.code === "SENSITIVE_FILE_EXPOSURE_CONFIRMED" || f.code === "SENSITIVE_FILE_POSSIBLE_EXPOSURE";
  const isHardening = (f) => ["WP_DEBUG_DISPLAY_ENABLED", "DASHBOARD_FILE_EDITING_ENABLED", "SECURITY_HEADER_MISSING", "SECURITY_HEADER_WEAK_POLICY", "XMLRPC_ENDPOINT_RESPONDS"].includes(f.code);
  const isNotChecked = (f) => ["SECURITY_EVIDENCE_INSUFFICIENT", "COMPONENT_VERSION_UNKNOWN", "SECURITY_CHECK_NOT_RUN"].includes(f.code);
  const isProvider = (f) => f.code === "VULNERABILITY_PROVIDER_UNAVAILABLE" || f.code === "VULNERABILITY_PROVIDER_RATE_LIMITED";
  const advisory = diagnostic.findings.filter(isAdvisory);
  const outdated = diagnostic.findings.filter(isOutdated);
  const hardening = diagnostic.findings.filter(isHardening);
  const exposure = diagnostic.findings.filter(isExposure);
  const notChecked = diagnostic.findings.filter(isNotChecked);
  const providerFindings = diagnostic.findings.filter(isProvider);
  const other = diagnostic.findings.filter((f) => !isAdvisory(f) && !isOutdated(f) && !isHardening(f) && !isExposure(f) && !isNotChecked(f) && !isProvider(f));

  function findingList(list) {
    return (
      <ul className="mt-3 space-y-3">
        {list.map((f) => (
          <li key={f.id} className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
            <p><strong>{f.title}</strong> <span className="text-slate-500">({f.code} · {f.severity} · confidence {f.confidence} · evidence: {f.evidenceStatus ?? "—"})</span></p>
            <p className="mt-1">{f.explanation}</p>
            {f.advisoryId || f.cveId || f.sourceUrl || f.fixedVersion ? (
              <p className="mt-1">
                {f.advisoryId ? `Advisory: ${f.advisoryId}. ` : ""}{f.cveId ? `CVE: ${f.cveId}. ` : ""}{f.fixedVersion ? `Fixed version (where supplied): ${f.fixedVersion}. ` : ""}{f.sourceUrl ? (<a className="font-medium text-blue-700 underline" href={f.sourceUrl} target="_blank" rel="noreferrer">Source</a>) : ""}{f.retrievedAt ? ` · retrieved ${new Date(f.retrievedAt).toLocaleString()}` : ""}
              </p>
            ) : null}
            <p className="mt-1"><strong>Recommended next step:</strong> {f.recommendation}</p>
          </li>
        ))}
      </ul>
    );
  }

  function section(headingId, title, list, intro) {
    if (list.length === 0) return null;
    return (
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby={headingId}>
        <h2 id={headingId} className="text-lg font-semibold">{title}</h2>
        {intro ? <p className="mt-2 text-sm text-slate-600">{intro}</p> : null}
        {findingList(list)}
      </section>
    );
  }

  return (
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Security report</h1>
        <p className="mt-2 text-slate-600">
          Target: {diagnostic.sanitizedWebsiteUrl} · Status: {diagnostic.executionStatus}
          {" · "}{new Date(diagnostic.createdAt).toLocaleString()}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Snapshot: {diagnostic.snapshotSchemaVersion ? `schema v${diagnostic.snapshotSchemaVersion}` : "none"}
          {diagnostic.snapshotReceivedAt ? `, received ${new Date(diagnostic.snapshotReceivedAt).toLocaleString()}` : ""}
          {` · freshness: ${diagnostic.snapshotFreshness}`}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Providers: {providers.map((p) => `${p.providerId}: ${p.status}`).join(", ") || "—"}
          {` · matched advisories: ${adv.matchedAdvisoryCount ?? 0}`}
        </p>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="sec-inventory-heading">
          <h2 id="sec-inventory-heading" className="text-lg font-semibold">Component inventory (snapshot)</h2>
          <p className="mt-2 text-sm text-slate-700">
            WordPress core: {inv.core?.version ?? "unknown"}
            {inv.theme ? ` · Active theme: ${inv.theme.name ?? "unknown"} ${inv.theme.version ?? ""} (advisory identity uncertain — no slug in snapshot)` : ""}
          </p>
          {Array.isArray(inv.plugins) && inv.plugins.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {inv.plugins.map((p, i) => (
                <li key={i}>{p.name} — {p.slug ?? "no slug"}, version {p.version ?? "unknown"}, active: {p.active ? "yes" : "no"}{p.updateAvailable ? `, update available${p.newVersion ? ` (${p.newVersion})` : ""}` : ""}, advisory status: {p.providerStatus}</li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-slate-700">No plugin inventory in this report.</p>}
          {inv.securityIndicators ? (
            <p className="mt-3 text-sm text-slate-700">
              Hardening flags (schema v6): WP_DEBUG {inv.securityIndicators.wpDebug}, WP_DEBUG_DISPLAY {inv.securityIndicators.wpDebugDisplay}, WP_DEBUG_LOG {inv.securityIndicators.wpDebugLog}, DISALLOW_FILE_EDIT {inv.securityIndicators.disallowFileEdit}.
            </p>
          ) : <p className="mt-3 text-sm text-slate-700">No hardening flags in this snapshot (pre-v6 connector). Hardening configuration could not be assessed.</p>}
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="sec-http-heading">
          <h2 id="sec-http-heading" className="text-lg font-semibold">Passive HTTP observations</h2>
          <div className="mt-2 space-y-1 text-sm text-slate-700">
            <p>Homepage: {http.homepage?.status !== null && http.homepage?.status !== undefined ? `HTTP ${http.homepage.status}` : "not observed"}{http.homepage?.crossHostRedirect ? " (cross-host redirect — not followed)" : ""}{http.homepage?.error ? ` — check did not run: ${http.homepage.error}` : ""}</p>
            <p>Security headers observed: {http.homepage?.headers ? Object.keys(http.homepage.headers).join(", ") || "none of the six checked headers" : "—"}</p>
            <p>XML-RPC: {http.xmlrpc?.responds ? `responds (HTTP ${http.xmlrpc.status}) — observation only, not a vulnerability` : http.xmlrpc?.error ? `check did not run: ${http.xmlrpc.error}` : "not observed"}</p>
            <p>Sensitive paths: {Array.isArray(http.sensitivePaths) && http.sensitivePaths.length > 0 ? http.sensitivePaths.map((p) => `${p.path}: ${p.result} (HTTP ${p.status ?? "—"})`).join("; ") : "—"}</p>
          </div>
          <p className="mt-2 text-sm text-slate-600">No response body is stored or shown for sensitive-path probes — only the classification above. A 403/404 does not prove a file is absent.</p>
        </section>

        {section("sec-advisory-heading", "Known advisory matches", advisory, "Version-matched advisories from the checked source. These are potential vulnerabilities, not proof of exploitation.")}
        {section("sec-outdated-heading", "Outdated components", outdated, "Outdated is not the same as vulnerable.")}
        {section("sec-hardening-heading", "Observed hardening concerns", hardening)}
        {section("sec-exposure-heading", "Sensitive-file results", exposure, "Confirmed means a 200 response matched the expected file signature. Possible means a 200 response without a matching signature — confirm manually before acting.")}
        {section("sec-provider-heading", "Provider / network unavailable", providerFindings, "Advisory matching is incomplete where the provider was unavailable. This is never a clean scan.")}
        {section("sec-notchecked-heading", "Not checked — insufficient evidence", notChecked, "These items could not be assessed from the available evidence. They are not passes and not confirmed defects.")}
        {section("sec-other-heading", "Other findings", other)}

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="sec-nomatch-heading">
          <h2 id="sec-nomatch-heading" className="text-lg font-semibold">What &quot;no matching advisory&quot; means</h2>
          <p className="mt-2 text-sm text-slate-600">
            Components whose advisory status is NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES returned no match from WPVulnerability
            for the checked version. That is the only claim made for them. It does not mean the component — or the site — is
            secure, and this report never uses a &quot;100% Secure&quot; label.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            {limitations.map((l, i) => (<li key={i}>{l}</li>))}
          </ul>
        </section>

        <SecurityAiSection diagnosticId={diagnostic.id} initial={publicSecurityAnalysis(diagnostic.aiAnalysis)} />

        <p className="mt-6 text-sm text-slate-600">
          <a className="font-medium text-blue-700 underline" href="/tools/security-scanner/history">Back to security scan history</a>
        </p>
      </main>
    </Container>
  );
}
