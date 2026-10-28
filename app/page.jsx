import PageContainer from "../components/PageContainer";
import HomeHeroActions from "../components/HomeHeroActions";
import ToolCard from "../components/ToolCard";
import ResponsiveGrid from "../components/ResponsiveGrid";
import StatusIndicator from "../components/StatusIndicator";
import { TOOL_CATEGORIES } from "../lib/tools-nav";

// Homepage: responsive hero (two columns on wide screens, stacked on
// mobile) + the full 12-tool grid grouped by category. The diagnostic
// preview panel uses abstract shapes and status chips only — no fake
// data, no fake stats, no scan results. The stale Milestone 0
// "not built yet" list (accounts, scans, connector) is replaced by the
// current honest limits, which the tool pages themselves state.
export default function Home() {
  return (
    <PageContainer>
      <main className="py-12 sm:py-16">
        <div className="grid min-w-0 items-center gap-10 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-wide text-accent">WP DOCTOR AI</p>
            <h1 className="mt-3 text-balance text-4xl font-bold leading-tight text-ink sm:text-5xl">
              Find out what is wrong with your WordPress site — with evidence.
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-secondary">
              WP Doctor AI diagnoses WordPress problems step by step — detect, collect
              evidence, analyze, explain, recommend — and, when a fix needs a human,
              connects you with an expert repair workflow where every repair is approved
              before it happens and verified afterwards.
            </p>
            <HomeHeroActions />
          </div>
          <section
            aria-label="Diagnostic preview"
            className="min-w-0 rounded-2xl border border-border bg-surface p-6 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              How a diagnosis reads
            </p>
            <ul className="mt-4 space-y-3">
              <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-paper px-4 py-3">
                <span className="min-w-0 break-words text-sm font-medium">Evidence collected</span>
                <StatusIndicator status="completed" label="Completed" />
              </li>
              <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-paper px-4 py-3">
                <span className="min-w-0 break-words text-sm font-medium">Finding with low confidence</span>
                <StatusIndicator status="insufficient-evidence" label="Insufficient evidence" />
              </li>
              <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-paper px-4 py-3">
                <span className="min-w-0 break-words text-sm font-medium">Restore / migration execution</span>
                <StatusIndicator status="blocked" label="Blocked" />
              </li>
              <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-paper px-4 py-3">
                <span className="min-w-0 break-words text-sm font-medium">Scheduled monitoring</span>
                <StatusIndicator status="scheduler-inactive" label="Scheduler inactive" />
              </li>
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-ink-secondary">
              This panel is illustrative only: it shows the kinds of status labels a real
              report uses. It is not a scan result and contains no site data.
            </p>
          </section>
        </div>

        <section id="tools" className="mt-16 scroll-mt-24" aria-labelledby="tools-heading">
          <h2 id="tools-heading" className="text-2xl font-bold text-ink">
            All diagnostic tools
          </h2>
          <p className="mt-2 max-w-3xl text-ink-secondary">
            Twelve tools, grouped by what they check. Every report belongs to your account
            only, and every finding is labelled with its evidence and confidence.
          </p>
          {TOOL_CATEGORIES.map((category) => (
            <section key={category.id} className="mt-10" aria-labelledby={`home-${category.id}`}>
              <h3 id={`home-${category.id}`} className="text-lg font-semibold text-ink">
                {category.label}
              </h3>
              <ResponsiveGrid className="mt-4">
                {category.tools.map((tool) => (
                  <ToolCard key={tool.href} tool={tool} />
                ))}
              </ResponsiveGrid>
            </section>
          ))}
        </section>

        <section
          className="mt-16 rounded-xl border border-warning/40 bg-amber-50 p-6"
          aria-labelledby="honest-heading"
        >
          <h2 id="honest-heading" className="text-lg font-semibold text-ink">
            Honest status
          </h2>
          <p className="mt-2 text-ink-secondary">
            These limits apply across the app and are stated on the relevant tool pages too:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-ink-secondary">
            <li>
              Backup, restore &amp; migration is partial: backup creation and planning are
              supported, but live restore and migration execution are blocked — a confirmed
              job ends BLOCKED with no target change.
            </li>
            <li>
              Scheduled monitoring is inactive until an external scheduler calls the tick
              endpoint with its secret; until then only manual checks work.
            </li>
            <li>
              AI analysis, email delivery, and Google Search Console are not configured, so
              AI explanations, email alerts, and real indexing status are unavailable.
            </li>
            <li>
              The expert repair workflow is a later milestone and is not available yet. No
              repair tickets exist.
            </li>
            <li>
              No result on this site ever means a site is completely secure, malware-free,
              or fully indexed.
            </li>
          </ul>
          <p className="mt-3 text-ink-secondary">
            Service status:{" "}
            <a className="font-medium text-accent underline underline-offset-4" href="/api/health">
              /api/health
            </a>
          </p>
        </section>
      </main>
    </PageContainer>
  );
}
