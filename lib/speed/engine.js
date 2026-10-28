// Deterministic speed findings engine (Milestone 9, pure — no I/O).
// Inputs are the already-validated HTTP preflight summary, the validated
// Lighthouse summary, and the validated CrUX summary. Outputs: findings
// (defect/opportunity rows persisted as SpeedDiagnosticFinding) and
// notices (availability states — LAB_DATA_UNAVAILABLE, FIELD_DATA_UNAVAILABLE,
// PROVIDER_UNAVAILABLE, INSUFFICIENT_EVIDENCE — which are NOT finding rows:
// a missing metric alone never creates a finding, and missing data is
// never shown as a green success). Lab and field are never merged into a
// synthetic combined metric, and lab TBT is never reported as field INP.
import { classifyCls, classifyInp, classifyLcp, classifyTbt, httpElapsedSeverity } from "./thresholds.js";
import { buildAuditFindings } from "./audits.js";

function metricFinding({ ruleId, category, source, sourceMetric, valueText, classification, title, description, recommendation }) {
  return {
    ruleId,
    category,
    severity: classification === "POOR" ? "HIGH" : "MEDIUM",
    source,
    sourceAuditId: null,
    sourceMetric,
    title,
    description,
    evidence: { valueText, classification },
    recommendation,
    confidence: source === "CRUX" ? "HIGH" : "MEDIUM",
    relatedMetric: sourceMetric,
  };
}

export function runSpeedRules({ http = null, lighthouse = null, crux = null, providerStatuses = {} } = {}) {
  const findings = [];
  const notices = [];

  // ---- Basic HTTP preflight (total response time, NOT TTFB) ----
  if (http) {
    if (typeof http.status === "number" && http.status >= 400) {
      findings.push({
        ruleId: "HTTP_RESPONSE_ERROR",
        category: "HTTP_RESPONSE_ERROR",
        severity: http.status >= 500 ? "HIGH" : "MEDIUM",
        source: "HTTP",
        sourceAuditId: null,
        sourceMetric: null,
        title: `Page returned HTTP ${http.status}`,
        description:
          `The basic HTTP preflight received status ${http.status}. Provider lab/field checks still ran against the final URL where possible, but an error status means visitors may not see a working page.`,
        evidence: { status: http.status, finalUrl: http.finalUrl ?? null },
        recommendation: "Fix the HTTP error first — speed work on an error page does not help visitors.",
        confidence: "HIGH",
        relatedMetric: null,
      });
    }
    const sev = httpElapsedSeverity(http.elapsedMs);
    if (sev) {
      findings.push({
        ruleId: "HTTP_SLOW_TOTAL_RESPONSE",
        category: "SLOW_HTTP_RESPONSE",
        severity: sev,
        source: "HTTP",
        sourceAuditId: null,
        sourceMetric: null,
        title: "Total HTTP response time is slow",
        description:
          `The basic HTTP preflight took ${http.elapsedMs} ms in total (all redirects included). This is total response time measured from this server — it is NOT time-to-first-byte, and it is NOT the value Google measured in its lab run.`,
        evidence: { elapsedMs: http.elapsedMs, redirectCount: http.redirectCount ?? null },
        recommendation: "Investigate hosting, caching, and server response time; re-run to compare totals after changes.",
        confidence: "MEDIUM",
        relatedMetric: null,
      });
    }
  }

  // ---- Lab (Lighthouse) metrics ----
  if (lighthouse) {
    if (lighthouse.lcpMs !== null && lighthouse.lcpMs !== undefined) {
      const c = classifyLcp(lighthouse.lcpMs);
      if (c === "NEEDS_IMPROVEMENT" || c === "POOR") {
        findings.push(metricFinding({
          ruleId: "LAB_HIGH_LCP", category: "HIGH_LCP", source: "LIGHTHOUSE",
          sourceMetric: "lcpMs", valueText: `${lighthouse.lcpMs} ms (lab)`, classification: c,
          title: "Lab Largest Contentful Paint is slow",
          description: `Lighthouse measured LCP of ${lighthouse.lcpMs} ms in the lab run (good ≤ 2500 ms, needs improvement ≤ 4000 ms). Lab results come from a simulated device and network, not real visitors.`,
          recommendation: "Address the render-blocking and image findings in this report, then re-run the lab check.",
        }));
      }
    }
    if (lighthouse.cls !== null && lighthouse.cls !== undefined) {
      const c = classifyCls(lighthouse.cls);
      if (c === "NEEDS_IMPROVEMENT" || c === "POOR") {
        findings.push(metricFinding({
          ruleId: "LAB_HIGH_CLS", category: "HIGH_CLS", source: "LIGHTHOUSE",
          sourceMetric: "cls", valueText: `${lighthouse.cls} (lab)`, classification: c,
          title: "Lab Cumulative Layout Shift is high",
          description: `Lighthouse measured CLS of ${lighthouse.cls} in the lab run (good < 0.1, needs improvement ≤ 0.25). Lab shift may differ from what real visitors experience.`,
          recommendation: "Reserve space for images, ads, and embeds (width/height or aspect-ratio) so content does not jump as it loads.",
        }));
      }
    }
    if (lighthouse.tbtMs !== null && lighthouse.tbtMs !== undefined) {
      const c = classifyTbt(lighthouse.tbtMs);
      if (c === "NEEDS_IMPROVEMENT" || c === "POOR") {
        findings.push(metricFinding({
          ruleId: "LAB_HIGH_TBT", category: "HIGH_TBT", source: "LIGHTHOUSE",
          sourceMetric: "tbtMs", valueText: `${lighthouse.tbtMs} ms (lab TBT)`, classification: c,
          title: "Lab Total Blocking Time is high",
          description: `Lighthouse measured Total Blocking Time of ${lighthouse.tbtMs} ms in the lab run. TBT is a lab-only metric: it is NOT Interaction to Next Paint and must not be compared with field INP.`,
          recommendation: "Reduce long JavaScript tasks on page load (defer non-critical scripts, split bundles).",
        }));
      }
    }
    if (lighthouse.inpMs !== null && lighthouse.inpMs !== undefined) {
      const c = classifyInp(lighthouse.inpMs);
      if (c === "NEEDS_IMPROVEMENT" || c === "POOR") {
        findings.push(metricFinding({
          ruleId: "LAB_HIGH_INP", category: "HIGH_INP", source: "LIGHTHOUSE",
          sourceMetric: "inpMs", valueText: `${lighthouse.inpMs} ms (lab)`, classification: c,
          title: "Lab Interaction to Next Paint is slow",
          description: `Lighthouse reported an interaction-to-next-paint value of ${lighthouse.inpMs} ms in the lab run (good < 200 ms, needs improvement ≤ 500 ms). This is a lab value; field INP from real users is shown separately when available.`,
          recommendation: "Reduce main-thread blocking during interaction (defer scripts, avoid long tasks on event handlers).",
        }));
      }
    }
    const { findings: auditFindings, unknownAuditCount } = buildAuditFindings(lighthouse.audits ?? []);
    findings.push(...auditFindings);
    if (unknownAuditCount > 0) {
      notices.push({ code: "UNKNOWN_AUDITS_PRESERVED", detail: `${unknownAuditCount} Lighthouse audit(s) were not mapped to findings; their provider values are preserved in the lab summary.` });
    }
  } else {
    notices.push({
      code: providerStatuses.psi === "NOT_CONFIGURED" ? "LAB_DATA_UNAVAILABLE" : "PROVIDER_UNAVAILABLE",
      detail: providerStatuses.psi === "NOT_CONFIGURED"
        ? "Lighthouse lab data is unavailable because PageSpeed Insights is not configured."
        : "Lighthouse lab data is unavailable because the PageSpeed Insights request failed.",
    });
  }

  // ---- Field (CrUX) metrics — p75, scope labelled ----
  if (crux) {
    const scopeLabel = crux.scope === "origin" ? "origin-level (all pages on this origin)" : "page-level";
    const field = [
      { key: "lcp", ruleId: "FIELD_HIGH_LCP", category: "HIGH_LCP", title: "Field Largest Contentful Paint is slow", valueText: (v) => `${v} ms (field p75, ${scopeLabel})`, classify: classifyLcp, rec: "Prioritise the largest visible content: faster server responses, optimised hero images, and less render-blocking work." },
      { key: "inp", ruleId: "FIELD_HIGH_INP", category: "HIGH_INP", title: "Field Interaction to Next Paint is slow", valueText: (v) => `${v} ms (field p75, ${scopeLabel})`, classify: classifyInp, rec: "Reduce interaction latency: less main-thread work on event handlers and fewer heavy scripts." },
      { key: "cls", ruleId: "FIELD_HIGH_CLS", category: "HIGH_CLS", title: "Field Cumulative Layout Shift is high", valueText: (v) => `${v} (field p75, ${scopeLabel})`, classify: classifyCls, rec: "Reserve space for late-loading content so the layout does not shift for real visitors." },
    ];
    for (const f of field) {
      const m = crux.metrics?.[f.key];
      if (!m) continue;
      const value = f.key === "cls" ? m.p75 : m.p75Ms;
      const c = m.classification ?? (value === null || value === undefined ? "UNAVAILABLE" : f.classify(value));
      if (c === "NEEDS_IMPROVEMENT" || c === "POOR") {
        findings.push(metricFinding({
          ruleId: f.ruleId, category: f.category, source: "CRUX",
          sourceMetric: f.key, valueText: f.valueText(value), classification: c,
          title: f.title,
          description: `Chrome UX Report field data (${scopeLabel}, ${crux.formFactor ?? "unknown form factor"}, collection period ${crux.collectionPeriod ? `${crux.collectionPeriod.firstDate?.year ?? "?"}-${crux.collectionPeriod.firstDate?.month ?? "?"}-${crux.collectionPeriod.firstDate?.day ?? "?"} to ${crux.collectionPeriod.lastDate?.year ?? "?"}-${crux.collectionPeriod.lastDate?.month ?? "?"}-${crux.collectionPeriod.lastDate?.day ?? "?"}` : "not reported"}) shows a 75th-percentile value classified ${c}.` +
            (crux.scope === "origin" ? " Origin-level data describes the whole origin, not this exact page." : ""),
          recommendation: f.rec,
        }));
      }
    }
  } else {
    notices.push({
      code: providerStatuses.crux === "NOT_CONFIGURED" ? "FIELD_DATA_UNAVAILABLE" : "FIELD_DATA_UNAVAILABLE",
      detail: providerStatuses.crux === "NOT_CONFIGURED"
        ? "Field data is unavailable because the Chrome UX Report API is not configured."
        : "Field data is unavailable: no CrUX record exists for this page or origin, or the request failed. Missing field data is not a failure of the page — low-traffic pages often have no record.",
    });
  }

  if (!lighthouse && !crux) {
    notices.push({ code: "INSUFFICIENT_EVIDENCE", detail: "Only basic HTTP diagnostics are available for this report; lab and field evidence are missing, so no speed conclusion beyond the HTTP result is drawn." });
  }

  return { findings, notices };
}
