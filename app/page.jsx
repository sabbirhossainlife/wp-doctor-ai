const planned = [
  {
    title: "Website Error Checker",
    note: "Public availability, HTTP status, redirects and timeouts — with evidence, not guesses.",
  },
  {
    title: "Plugin & Theme Conflict Checker",
    note: "Read-only diagnostics from an authorized WordPress connector. No automatic deactivation.",
  },
  {
    title: "WooCommerce Checkout Checker",
    note: "Configuration and error evidence only. No real payments, no order changes.",
  },
  {
    title: "Elementor & Layout Checker",
    note: "Editor and asset-loading evidence, with visual symptoms kept separate from technical facts.",
  },
];

const notYetBuilt = [
  "User accounts, login and dashboard",
  "Diagnostic scans and reports",
  "WordPress connector plugin",
  "AI diagnosis",
  "Repair requests, quotations and admin workflow",
  "Payments and subscriptions",
];

import Container from "../components/Container";

export default function Home() {
  return (
    <Container>
      <main className="py-16">
      <p className="text-sm font-semibold tracking-wide text-blue-700">
        WP DOCTOR AI
      </p>
      <h1 className="mt-3 text-4xl font-bold leading-tight">
        Find out what is wrong with your WordPress site — with evidence.
      </h1>
      <p className="mt-4 text-lg text-slate-600">
        WP Doctor AI will diagnose WordPress problems step by step — detect,
        collect evidence, analyze, explain, recommend — and, when a fix needs a
        human, connect you with an expert repair workflow where every repair is
        approved before it happens and verified afterwards.
      </p>

      <section className="mt-12" aria-labelledby="planned-heading">
        <h2 id="planned-heading" className="text-2xl font-semibold">
          What is planned
        </h2>
        <ul className="mt-4 space-y-4">
          {planned.map((item) => (
            <li
              key={item.title}
              className="rounded-xl border border-slate-200 bg-white p-5"
            >
              <h3 className="font-semibold">{item.title}</h3>
              <p className="mt-1 text-slate-600">{item.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="mt-12 rounded-xl border border-amber-200 bg-amber-50 p-5"
        aria-labelledby="not-built-heading"
      >
        <h2 id="not-built-heading" className="text-lg font-semibold">
          Honest status: not built yet
        </h2>
        <p className="mt-2 text-slate-700">
          This page is the Milestone 0 foundation only. The items below do not
          exist yet, and nothing on this page is a live scan or a real result:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-700">
          {notYetBuilt.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-slate-700">
          Service status:{" "}
          <a className="font-medium text-blue-700 underline" href="/api/health">
            /api/health
          </a>
        </p>
      </section>
      </main>
    </Container>
  );
}
