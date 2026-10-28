"use client";

import { useState } from "react";

const FRIENDLY_ERROR = {
  AI_NOT_CONFIGURED: "AI explanations are not configured yet.",
  RATE_LIMITED: "Too many AI explanations requested. Try again later.",
  PROVIDER_RATE_LIMITED: "The AI provider rate limit was reached. Try again later.",
  PROVIDER_TIMEOUT: "The AI provider request timed out. You can retry.",
  PROVIDER_ERROR: "The AI provider is temporarily unavailable. You can retry.",
  PROVIDER_REFUSAL: "The AI provider refused to answer. You can retry.",
  INVALID_OUTPUT: "The AI provider returned an unusable result. You can retry.",
  SCAN_NOT_TERMINAL: "This scan is not ready for AI analysis yet.",
};

function ConfidenceBadge({ value }) {
  const style =
    value === "HIGH"
      ? "bg-red-50 text-red-800 border-red-200"
      : value === "MEDIUM"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-slate-100 text-slate-800 border-slate-200";
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${style}`}>Confidence: {value}</span>;
}

// initialAnalysis: serialized public analysis row or null. aiConfigured is
// derived server-side from env presence only (no secret values reach the
// browser). Only validated, persisted analysis is ever rendered here.
export default function AiAnalysisSection({ scanId, initialAnalysis, aiConfigured }) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [state, setState] = useState("idle"); // idle | generating | error
  const [errorCode, setErrorCode] = useState(null);

  async function generate(regenerate) {
    setState("generating");
    setErrorCode(null);
    try {
      const res = await fetch(`/api/scans/${scanId}/ai-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorCode(json.code || "PROVIDER_ERROR");
        setState("error");
        return;
      }
      setAnalysis(json.analysis);
      setState("idle");
    } catch {
      setErrorCode("PROVIDER_ERROR");
      setState("error");
    }
  }

  const data = analysis?.status === "COMPLETED" ? analysis.analysis : null;

  return (
    <section className="mt-10 rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="ai-heading">
      <h2 id="ai-heading" className="text-2xl font-semibold">AI explanation</h2>
      <p className="mt-2 text-sm text-slate-600">
        An interpretation of the scanner evidence above — not a scanner finding.
        The verified findings remain the source of truth, and AI explanations
        are never guaranteed correct.
      </p>

      {!data && !aiConfigured && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700">
          AI explanations are not configured yet. The deterministic scan report
          above remains fully available without AI.
        </p>
      )}

      {data && (
        <div className="mt-4 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <ConfidenceBadge value={data.diagnosticConfidence} />
            {data.humanReviewRecommended && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                Human review recommended
              </span>
            )}
          </div>
          <div>
            <h3 className="font-semibold">Summary</h3>
            <p className="mt-1 text-sm text-slate-700">{data.summary}</p>
          </div>
          <div>
            <h3 className="font-semibold">Explanation</h3>
            <p className="mt-1 text-sm text-slate-700">{data.explanation}</p>
          </div>
          {data.confirmedObservations?.length > 0 && (
            <div>
              <h3 className="font-semibold">What was observed</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {data.confirmedObservations.map((o, i) => (
                  <li key={i}>{o.observation}</li>
                ))}
              </ul>
            </div>
          )}
          {data.causeHypotheses?.length > 0 && (
            <div>
              <h3 className="font-semibold">Possible causes (hypotheses, not confirmed findings)</h3>
              <ul className="mt-2 space-y-3">
                {data.causeHypotheses.map((h, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
                    <p><strong>{h.title}</strong> · Confidence: {h.confidence}</p>
                    <p className="mt-1">{h.explanation}</p>
                    <p className="mt-1"><strong>Evidence still needed:</strong> {h.additionalEvidenceRequired}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.recommendedActions?.length > 0 && (
            <div>
              <h3 className="font-semibold">Recommended actions</h3>
              <ul className="mt-2 space-y-3">
                {data.recommendedActions.map((a, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
                    <p><strong>{a.title}</strong> · Priority: {a.priority} · Risk: {a.riskLevel} · Skill: {a.skillLevel}</p>
                    <p className="mt-1">{a.explanation}</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5">
                      {a.steps.map((s, j) => (<li key={j}>{s}</li>))}
                    </ol>
                    {a.humanReviewRecommended && (
                      <p className="mt-2 font-semibold text-amber-800">Human review recommended before this action.</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.missingEvidence?.length > 0 && (
            <div>
              <h3 className="font-semibold">Missing evidence</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {data.missingEvidence.map((m, i) => (<li key={i}>{m}</li>))}
              </ul>
            </div>
          )}
          {data.limitations?.length > 0 && (
            <div>
              <h3 className="font-semibold">Limitations</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {data.limitations.map((l, i) => (<li key={i}>{l}</li>))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Generated {analysis.completedAt ? new Date(analysis.completedAt).toLocaleString() : ""}
            {analysis.provider ? ` · Provider: ${analysis.provider}` : ""}
            {analysis.model ? ` · Model: ${analysis.model}` : ""}
          </p>
          {aiConfigured && (
            <button
              type="button"
              onClick={() => generate(true)}
              disabled={state === "generating"}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {state === "generating" ? "Generating…" : "Regenerate AI explanation"}
            </button>
          )}
        </div>
      )}

      {!data && aiConfigured && (
        <div className="mt-4">
          {analysis?.status === "FAILED" && (
            <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-slate-700" role="alert">
              The last AI explanation attempt failed
              {analysis.errorCode ? ` (${analysis.errorCode})` : ""}. You can retry.
            </p>
          )}
          <button
            type="button"
            onClick={() => generate(false)}
            disabled={state === "generating"}
            className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {state === "generating" ? "Generating…" : analysis?.status === "FAILED" ? "Retry AI explanation" : "Generate AI explanation"}
          </button>
        </div>
      )}

      {state === "error" && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-slate-700" role="alert">
          {FRIENDLY_ERROR[errorCode] || "Could not generate the AI explanation. You can retry."}
        </p>
      )}
    </section>
  );
}
