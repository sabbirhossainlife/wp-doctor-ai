import PageContainer from "./PageContainer";

// Simple footer: brand plus an honest status line. No invented links.
export default function PageFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <PageContainer className="flex min-w-0 flex-col gap-2 py-6 text-sm text-ink-secondary sm:flex-row sm:items-center sm:justify-between">
        <p className="whitespace-nowrap font-semibold text-ink">WP Doctor AI</p>
        <p className="min-w-0 break-words">
          Evidence-based WordPress diagnostics. Results describe what was checked — never a
          guarantee that a site is fully secure, clean, or indexed.{" "}
          <a className="font-medium text-accent underline underline-offset-4" href="/api/health">
            Service status
          </a>
        </p>
      </PageContainer>
    </footer>
  );
}
