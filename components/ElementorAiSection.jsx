"use client";

import { useState } from "react";

// Renders ONLY validated, persisted AI analysis. Deterministic findings
// live in a separate section on the report page and are never modified here.
// When AI is unconfigured the section states that plainly (503) instead of
// showing mock or invented content.
export default function ElementorAiSection({ diagnosticId, initialAnalysis, aiConfigured }) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [state, setState] = useState("idle"); // idle | generating | error
  const [error, setError] = useState("");

  async function generate() {
    if (state === "generating") return;
    setState("generating");
    setError("");
    try {
      const res = await fetch(`/api/elementor-diagnostics/${diagnosticId}/ai-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setError("AI interpretation is not configured. The deterministic findings above are the complete report.");
        setState("error");
        return;
      }
      if (!res.ok) {
        setError(json.error || "The AI provider could not produce a valid interpretation. You can retry.");
        setState("error");
        return;
      }
      setAnalysis(json.analysis);
      setState("idle");
    } catch {
      setError("Could not generate the AI interpretation. You can retry.");
      setState("error");
    }
  }

  const data = analysis?.status === "COMPLETED" ? analysis.analysis : null;

  return (
    <section className="mt-10 rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="el-ai-heading">
      <h2 id="el-ai-heading" className="text-xl font-semibold">AI interpretation (separate from deterministic findings)</h2>
      <p className="mt-2 text-sm text-slate-600">
        This section is an AI explanation of the findings above. It is interpretation, not evidence: it never changes the deterministic findings, never names a plugin as a confirmed cause, never claims a console error or a visual verification, and never claims Safe Mode fixed anything — no console data, rendering test, isolation test, or screenshot was collected.
      </p>
      {!data && !aiConfigured && (
        <p className="mt-4 text-sm text-slate-700">
          AI interpretation is not configured for this deployment. The
          deterministic findings above are the complete report.
        </p>
      )}
      {!data && aiConfigured && (
        <div className="mt-4">
          <button
            type="button"
            onClick={generate}
            disabled={state === "generating"}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {state === "generating" ? "Generating…" : "Generate AI interpretation"}
          </button>
          {state === "error" && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
      {data && (
        <div className="mt-4">
          <p className="text-sm"><strong>Summary:</strong> {data.summary}</p>
          <p className="mt-2 text-sm">{data.explanation}</p>
          <p className="mt-2 text-sm text-slate-600">Confidence: {data.diagnosticConfidence}</p>
          {data.causeHypotheses?.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold">Possible causes to investigate (hypotheses, not confirmed causes)</h3>
              <ul className="mt-2 space-y-2">
                {data.causeHypotheses.map((h, i) => (
                  <li key={i} className="text-sm text-slate-700">
                    <strong>{h.title}</strong> — {h.explanation} (confidence: {h.confidence}; still needed: {h.additionalEvidenceRequired})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.recommendedActions?.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold">Recommended safe next steps</h3>
              <ul className="mt-2 space-y-2">
                {data.recommendedActions.map((a, i) => (
                  <li key={i} className="text-sm text-slate-700">
                    <strong>{a.title}</strong> — {a.explanation}
                    <ul className="mt-1 list-disc pl-5">
                      {a.steps.map((s, j) => (<li key={j}>{s}</li>))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.missingEvidence?.length > 0 && (
            <p className="mt-4 text-sm text-slate-600"><strong>Missing evidence:</strong> {data.missingEvidence.join("; ")}</p>
          )}
          {data.limitations?.length > 0 && (
            <p className="mt-2 text-sm text-slate-600"><strong>Limitations:</strong> {data.limitations.join("; ")}</p>
          )}
        </div>
      )}
      {analysis?.status === "FAILED" && !data && (
        <p className="mt-4 text-sm text-red-700">The last AI interpretation attempt failed ({analysis.errorCode || "unknown error"}). You can retry{aiConfigured ? " with the button above." : "."}</p>
      )}
    </section>
  );
}
