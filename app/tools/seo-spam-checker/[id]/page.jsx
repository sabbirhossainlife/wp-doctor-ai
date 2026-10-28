import { redirect, notFound } from "next/navigation";
import Container from "../../../../components/Container";
import SeoAiSection from "../../../../components/SeoAiSection";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";
import { publicSeoAnalysis } from "../../../../lib/seo/ai";

function findingItem(f) {
  return (
    <li key={f.id} className="rounded-lg border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-800">{f.title}</p>
      <p className="mt-1 text-sm text-slate-700">{f.explanation}</p>
      <p className="mt-1 text-sm text-slate-600">
        Severity: {f.severity} · Confidence: {f.confidence} · Evidence: {f.evidenceStatus ?? "n/a"}
        {f.checkId ? <> · Check: {f.checkId}</> : null}
      </p>
      <p className="mt-1 text-sm text-slate-700"><strong>Recommended manual next step:</strong> {f.recommendation}</p>
    </li>
  );
}

function findingSection(id, title, description, list) {
  if (!list || list.length === 0) return null;
  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <ul className="mt-3 space-y-3">{list.map(findingItem)}</ul>
    </section>
  );
}

function byCheck(findings, checks) {
  return findings.filter((f) => checks.includes(f.checkId));
}

export default async function SeoDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const diagnostic = await prisma.seoDiagnostic.findFirst({
    where: { id, userId: user.id },
    include: { findings: { orderBy: { createdAt: "asc" } }, aiAnalysis: true },
  });
  if (!diagnostic) notFound();

  const homepage = diagnostic.homepageSummary && typeof diagnostic.homepageSummary === "object" ? diagnostic.homepageSummary : {};
  const robots = diagnostic.robotsSummary && typeof diagnostic.robotsSummary === "object" ? diagnostic.robotsSummary : {};
  const sitemap = diagnostic.sitemapSummary && typeof diagnostic.sitemapSummary === "object" ? diagnostic.sitemapSummary : {};
  const spam = diagnostic.spamSignals && typeof diagnostic.spamSignals === "object" ? diagnostic.spamSignals : {};
  const seoPlugin = diagnostic.seoPluginSummary && typeof diagnostic.seoPluginSummary === "object" ? diagnostic.seoPluginSummary : {};
  const advisory = diagnostic.advisoryContext && typeof diagnostic.advisoryContext === "object" ? diagnostic.advisoryContext : {};
  const limitations = Array.isArray(diagnostic.limitations) ? diagnostic.limitations : [];
  const findings = diagnostic.findings ?? [];
  const snapshotDate = diagnostic.snapshotReceivedAt ? new Date(diagnostic.snapshotReceivedAt).toLocaleString() : "not applicable (URL-only run)";

  return (
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">SEO diagnostic report</h1>
        <p className="mt-2 text-slate-600">
          {diagnostic.sanitizedWebsiteUrl} · Execution: {diagnostic.executionStatus}
          {diagnostic.finalUrl ? <> · Final URL: {diagnostic.finalUrl}</> : null}
          {diagnostic.snapshotSchemaVersion ? <> · Connector snapshot: schema v{diagnostic.snapshotSchemaVersion} received {snapshotDate} · Freshness: {diagnostic.snapshotFreshness ?? "unknown"}</> : <> · Snapshot: {snapshotDate}</>}
        </p>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="seo-summary-heading">
          <h2 id="seo-summary-heading" className="text-lg font-semibold">Observed summary</h2>
          <p className="mt-2 text-sm text-slate-700">
            Homepage status: {homepage.finalStatus ?? "unknown"} · Redirects: {homepage.redirectCount ?? "unknown"}
            {homepage.crossHostRedirect ? " · Cross-host redirect (destination not fetched)" : ""}
            {homepage.terminalError ? ` · Homepage check ended: ${homepage.terminalError}` : ""}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            robots.txt: {robots.present ? `present (status ${robots.status ?? "?"})` : "missing or unreachable"}
            {robots.blocksHomepage ? " · BLOCKS the homepage for all crawlers" : ""}
            {Array.isArray(robots.sitemapUrls) ? ` · Sitemap references: ${robots.sitemapUrls.length}` : ""}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            Sitemap: {sitemap.status ?? "unknown"} · Sitemaps checked: {sitemap.sitemapsChecked ?? 0} · Entries counted: {sitemap.entryCount ?? 0}
            {sitemap.homepagePresent === true ? " · Homepage found in checked sitemaps" : sitemap.homepagePresent === false ? " · Homepage NOT found in checked sitemaps (not an indexing verdict)" : ""}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            Spam signals: keyword categories: {(spam.keywordCategories ?? []).join(", ") || "none"} · External links in prefix: {spam.externalLinkCount ?? 0} · Hidden-style links: {spam.hiddenLinkCount ?? 0}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            SEO plugin: {seoPlugin.status ?? "unknown"}
            {Array.isArray(seoPlugin.activeSlugs) && seoPlugin.activeSlugs.length > 0 ? ` (active: ${seoPlugin.activeSlugs.join(", ")})` : ""}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            Search Console: {diagnostic.searchConsoleStatus} — no Search Console data was consulted; indexing status is UNKNOWN from this tool&apos;s evidence.
            {advisory.securityMatchedAdvisoryCount !== null && advisory.securityMatchedAdvisoryCount !== undefined ? ` Advisory context — latest Tool 08 matched advisories: ${advisory.securityMatchedAdvisoryCount}.` : ""}
          </p>
          <p className="mt-2 text-sm font-medium text-slate-800">
            This report never means the site is SEO-clean, fully indexed, or spam-free, and no single signal here proves a page is indexed, deindexed, hacked, or spammed.
          </p>
        </section>

        {findingSection("sec-indexing", "1. Indexing signals", "Homepage title, description, robots directives, and canonical evidence. noindex is a signal, not a deindexing verdict.", byCheck(findings, ["head", "headers", "homepage"]))}
        {findingSection("sec-robots", "2. robots.txt", "Crawl rules from the requested site's robots.txt (`*` group plus googlebot group if present).", byCheck(findings, ["robots"]))}
        {findingSection("sec-sitemap", "3. Sitemap", "Sitemap reachability, parseability, and whether the homepage appears in the checked sitemaps (never an indexing verdict).", byCheck(findings, ["sitemap"]))}
        {findingSection("sec-redirects", "4. Redirects", "Homepage redirect chain classification. Cross-host redirects are review flags, never malicious verdicts.", byCheck(findings, ["redirects"]))}
        {findingSection("sec-spam", "5. Spam indicators for review", "Heuristic indicators only, with false-positive warnings. A single generic signal never proves SEO spam or a compromise.", byCheck(findings, ["spam"]))}
        {findingSection("sec-gsc", "6. Search Console status", "No Search Console integration exists; real indexing status must be verified manually in Google Search Console.", byCheck(findings, ["search-console"]))}
        {findingSection("sec-not-checked", "7. Not checked / insufficient evidence", "Checks that could not run or evidence that was unavailable. Insufficient evidence is never a pass.", findings.filter((f) => f.evidenceStatus === "INSUFFICIENT_EVIDENCE" || f.code === "SEO_EVIDENCE_INSUFFICIENT" || f.code === "SEO_CHECK_NOT_RUN"))}

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="seo-next-heading">
          <h2 id="seo-next-heading" className="text-lg font-semibold">8. Manual next steps</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Verify real indexing status in Google Search Console (URL Inspection) — this tool cannot tell you whether a page is indexed.</li>
            <li>Fix only the findings you confirm in a browser or in Search Console; this tool changes nothing on your site.</li>
            <li>For spam-review flags, inspect the homepage in a browser and review theme, widget, and SEO-plugin settings before changing anything.</li>
            <li>For robots.txt or canonical changes, edit them in WordPress/hosting directly — never through this tool, which has no edit path.</li>
          </ul>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="seo-limits-detail-heading">
          <h2 id="seo-limits-detail-heading" className="text-lg font-semibold">Limitations</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            {limitations.map((l, i) => (<li key={i}>{l}</li>))}
          </ul>
          <p className="mt-3 text-sm text-slate-600">
            <a className="font-medium text-blue-700 underline" href="/tools/seo-spam-checker/history">Back to SEO diagnostic history</a>
          </p>
        </section>

        <SeoAiSection diagnosticId={diagnostic.id} initial={publicSeoAnalysis(diagnostic.aiAnalysis)} />
      </main>
    </Container>
  );
}
