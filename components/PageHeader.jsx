// Shared page header: breadcrumb/back link, title, and description.
// `children` (or `description`) is the page's own explanatory text, kept
// verbatim from the original page — never shortened into a vague summary.
export default function PageHeader({
  title,
  description,
  backHref = "/dashboard",
  backLabel = "Back to dashboard",
  children,
}) {
  const body = children ?? description;
  return (
    <div className="min-w-0">
      <p>
        <a
          className="font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
          href={backHref}
        >
          ← {backLabel}
        </a>
      </p>
      <h1 className="mt-3 min-w-0 text-balance text-3xl font-bold leading-tight text-ink sm:text-4xl">
        {title}
      </h1>
      {body ? (
        <div className="mt-3 max-w-3xl space-y-3 text-base leading-relaxed text-ink-secondary [&_p]:mt-0">
          {body}
        </div>
      ) : null}
    </div>
  );
}
