"use client";

import { useState } from "react";

// AI explanation section for an SEO report. The deterministic report is
// never modified by AI output; this section only displays the stored
// SeoAiAnalysis, clearly labelled as interpretation.
export default function SeoAiSection({ diagnosticId, initial }) {
  const [analysis, setAnalysis] = useState(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function request(regenerate = false) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/seo-diagnostics/${diagnosticId}/ai-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 503) setError("AI explanations are not configured. The deterministic report above stands alone.");
        else if (res.status === 429) setError("Too many AI explanations requested. Try again tomorrow.");
        else setError(data?.error || "The AI explanation could not be generated.");
        return;
      }
      setAnalysis(data.aiAnalysis);
    } catch {
      setError("The AI explanation could not be generated.");
    } finally {
      setLoading(false);
    }
  }

  const a = analysis?.analysis ?? null;
  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="seo-ai-heading">
      <h2 id="seo-ai-heading" className="text-lg font-semibold">AI explanation (interpretation only)</h2>
      {!a ? (
        <div className="mt-3">
          <p className="text-sm text-slate-600">
            Optional: ask AI to explain this report in plain language. AI never changes
            the deterministic findings above and never invents index states, plugin statuses, or spam verdicts.
          </p>
          {analysis?.status === "FAILED" ? (
            <p className="mt-2 text-sm text-red-700">The last AI attempt failed ({analysis.errorCode ?? "PROVIDER_ERROR"}). You can try again.</p>
          ) : null}
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
          <button
            type="button"
            onClick={() => request(false)}
            disabled={loading}
            className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Generating explanation…" : "Explain this report with AI"}
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-slate-700">{a.summary}</p>
          <p className="mt-2 text-sm text-slate-700">{a.explanation}</p>
          {a.confirmedObservations?.length ? (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">Confirmed observations (from the deterministic report only)</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {a.confirmedObservations.map((o, i) => (<li key={i}>{o.observation}</li>))}
              </ul>
            </div>
          ) : null}
          {a.causeHypotheses?.length ? (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">Possible explanations (hypotheses, not findings)</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {a.causeHypotheses.map((h, i) => (<li key={i}><strong>{h.title}.</strong> {h.explanation} Evidence still needed: {h.additionalEvidenceRequired}</li>))}
              </ul>
            </div>
          ) : null}
          {a.recommendedActions?.length ? (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">Recommended manual next steps</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {a.recommendedActions.map((r, i) => (<li key={i}><strong>{r.title}.</strong> {r.description}</li>))}
              </ul>
            </div>
          ) : null}
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
          <button
            type="button"
            onClick={() => request(true)}
            disabled={loading}
            className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Regenerating…" : "Regenerate explanation"}
          </button>
        </div>
      )}
    </section>
  );
}
