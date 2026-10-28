import { redirect } from "next/navigation";
import Container from "../../../components/Container";
import SeoCheckerForm from "../../../components/SeoCheckerForm";
import { getCurrentUser } from "../../../lib/session";
import { prisma } from "../../../lib/prisma";

export default async function SeoSpamCheckerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const websites = await prisma.website.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <Container>
      <main className="py-12">
        <h1 className="text-3xl font-bold">SEO Spam &amp; Indexing Checker</h1>
        <p className="mt-3 text-slate-600">
          Read-only, evidence-based SEO signals for a homepage: title and meta tags, robots.txt rules,
          sitemap contents, redirect behaviour, and conservative spam indicators for human review.
          All HTTP checks are passive, unauthenticated GETs through the SSRF-safe pinned scanner.
          Nothing here proves a page is indexed or deindexed, and no indicator here proves SEO spam
          or a hack — noindex, robots blocks, and sitemap absence are crawl signals, and spam
          indicators are heuristics with documented false positives.
        </p>
        <p className="mt-3 text-slate-600">
          How a run works, honestly: head evidence comes from the first 64 KiB of the homepage
          response only; a tag absent from that prefix is reported with a low-confidence caveat.
          Sitemap inspection is capped at 1,000 URLs and 5 child sitemaps, and listed pages are
          never fetched. Search Console is not connected, so real indexing status must be verified
          manually in Google Search Console. This tool never modifies robots.txt, metadata, redirects,
          settings, or site content.
        </p>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <SeoCheckerForm websites={websites.map((w) => ({ id: w.id, name: w.name, normalizedUrl: w.normalizedUrl }))} />
        </div>
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="seo-limits-heading">
          <h2 id="seo-limits-heading" className="text-lg font-semibold">What this check can and cannot do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Results are separated into: (1) Indexing signals, (2) robots.txt, (3) Sitemap, (4) Redirects, (5) Spam indicators for review, (6) Search Console status, (7) Not checked / insufficient evidence, (8) Manual next steps.</li>
            <li>Title/description length bands are WP Doctor heuristics, not Google rules. Open Graph and hreflang are presence-only checks — this tool never renders a social preview and never claims hreflang correctness.</li>
            <li>robots.txt parsing considers only the `*` group plus an explicit googlebot group if present; other agent groups are not evaluated.</li>
            <li>Spam keywords are matched in title + meta description text only, and only the category label is stored — never the matched text. Legitimate sites use these words in normal content.</li>
            <li>SEO-plugin evidence (registered-website runs only) identifies plugins by canonical slug only — display names are never used. Sitemap availability is never assumed from plugin presence.</li>
            <li>URL-only runs check no plugin evidence. Registered-website runs require a fresh (24-hour) connector snapshot from plugin 1.7.0 (schema v7).</li>
            <li>Each report belongs to your account only. Re-scans create new reports; old reports are never overwritten. A report with no findings never means a site is SEO-clean, fully indexed, or spam-free.</li>
          </ul>
          <p className="mt-3 text-sm text-slate-600">
            <a className="font-medium text-blue-700 underline" href="/tools/seo-spam-checker/history">View your SEO diagnostic history</a>
          </p>
        </section>
      </main>
    </Container>
  );
}
