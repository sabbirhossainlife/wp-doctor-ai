// Server-only provider adapters (Milestone 9). Fixed trusted hostnames —
// the base URL is NEVER user-configurable and no user parameter can change
// it. Keys come only from server environment variables and are never
// returned, logged, or stored. Responses are size-capped and strictly
// validated; unknown fields are ignored, never assumed present.
// No live provider call is made in tests: pass a mock fetchFn.
import { classifyCls, classifyInp, classifyLcp } from "./thresholds.js";

export const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export const CRUX_ENDPOINT =
  "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
export const PROVIDER_TIMEOUT_MS = 30000;
export const PROVIDER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class ProviderError extends Error {
  constructor(code, safeMessage) {
    super(safeMessage);
    this.name = "ProviderError";
    this.code = code;
  }
}

const SAFE = {
  NOT_CONFIGURED: "This provider is not configured.",
  TIMEOUT: "The provider request timed out.",
  QUOTA_EXCEEDED: "The provider quota was exceeded. Try again later.",
  SERVER_ERROR: "The provider returned a server error.",
  INVALID_RESPONSE: "The provider returned an unexpected response.",
  NETWORK_ERROR: "The provider request failed.",
  OVERSIZED_RESPONSE: "The provider response exceeded the permitted size.",
  NO_FIELD_DATA: "No field data is available for this target.",
};

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function finiteNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function capString(v, max = 500) {
  return typeof v === "string" ? v.slice(0, max) : null;
}
function capText(v, max = 2000) {
  return typeof v === "string" ? v.slice(0, max) : null;
}

async function readCappedText(response, fetchFn) {
  // Prefer a streaming read when available so an oversized body is cut
  // off without buffering it fully; fall back to .text() for mock fetches.
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PROVIDER_MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new ProviderError("OVERSIZED_RESPONSE", SAFE.OVERSIZED_RESPONSE);
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
    return new TextDecoder("utf-8").decode(merged);
  }
  const text = await response.text();
  if (text.length > PROVIDER_MAX_RESPONSE_BYTES) {
    throw new ProviderError("OVERSIZED_RESPONSE", SAFE.OVERSIZED_RESPONSE);
  }
  return text;
}

async function callProvider(url, options, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { ...options, signal: controller.signal });
    return response;
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new ProviderError("TIMEOUT", SAFE.TIMEOUT);
    }
    throw new ProviderError("NETWORK_ERROR", SAFE.NETWORK_ERROR);
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpError(status, provider) {
  if (status === 429) return new ProviderError("QUOTA_EXCEEDED", SAFE.QUOTA_EXCEEDED);
  if (status === 404 && provider === "crux") {
    return new ProviderError("NO_FIELD_DATA", SAFE.NO_FIELD_DATA);
  }
  if (status >= 500) return new ProviderError("SERVER_ERROR", SAFE.SERVER_ERROR);
  if (status === 400 || status === 401 || status === 403) {
    return new ProviderError("INVALID_RESPONSE", SAFE.INVALID_RESPONSE);
  }
  return new ProviderError("SERVER_ERROR", SAFE.SERVER_ERROR);
}

// ---- PageSpeed Insights (lab) -------------------------------------------
// Request: GET runPagespeed?url=<target>&strategy=<mobile|desktop>
//   &category=performance. Response shape validated against the documented
// v5 structure: lighthouseResult.categories.performance.score (0-1),
// lighthouseResult.audits (object), lighthouseResult.finalUrl/fetchTime.
// Metric values come from audit numericValue fields; a missing audit or a
// non-numeric value yields null for that metric, never a fabricated value.
const LAB_METRIC_AUDITS = {
  fcpMs: "first-contentful-paint",
  lcpMs: "largest-contentful-paint",
  tbtMs: "total-blocking-time",
  cls: "cumulative-layout-shift",
  speedIndexMs: "speed-index",
  interactiveMs: "interactive",
  serverResponseMs: "server-response-time",
  inpMs: "interaction-to-next-paint",
};

function summarizeAudit(id, audit) {
  if (!isPlainObject(audit)) return null;
  const savings = isPlainObject(audit.details) ? audit.details : null;
  return {
    id,
    title: capString(audit.title, 300),
    score: finiteNumber(audit.score),
    displayValue: capString(audit.displayValue, 300),
    numericValue: finiteNumber(audit.numericValue),
    numericUnit: capString(audit.numericUnit, 50),
    // Provider-supplied opportunity estimates ONLY; labelled "estimated"
    // by the UI and never presented as guaranteed savings.
    overallSavingsMs: savings ? finiteNumber(savings.overallSavingsMs) : null,
    overallSavingsBytes: savings ? finiteNumber(savings.overallSavingsBytes) : null,
  };
}

export async function fetchPsi({ target, strategy, apiKey, fetchFn = fetch }) {
  if (!apiKey) throw new ProviderError("NOT_CONFIGURED", SAFE.NOT_CONFIGURED);
  const url = new URL(PSI_ENDPOINT);
  url.searchParams.set("url", target);
  url.searchParams.set("strategy", strategy === "DESKTOP" ? "desktop" : "mobile");
  url.searchParams.set("category", "performance");
  const response = await callProvider(url.toString(), { method: "GET" }, fetchFn);
  if (!response.ok) throw mapHttpError(response.status, "psi");
  let json;
  try {
    json = JSON.parse(await readCappedText(response, fetchFn));
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError("INVALID_RESPONSE", SAFE.INVALID_RESPONSE);
  }
  if (!isPlainObject(json) || !isPlainObject(json.lighthouseResult)) {
    throw new ProviderError("INVALID_RESPONSE", SAFE.INVALID_RESPONSE);
  }
  const lr = json.lighthouseResult;
  const perf = isPlainObject(lr.categories) ? lr.categories.performance : null;
  const score = perf ? finiteNumber(perf.score) : null;
  if (score === null || score < 0 || score > 1) {
    throw new ProviderError("INVALID_RESPONSE", SAFE.INVALID_RESPONSE);
  }
  if (!isPlainObject(lr.audits)) {
    throw new ProviderError("INVALID_RESPONSE", SAFE.INVALID_RESPONSE);
  }
  const audits = [];
  for (const [id, audit] of Object.entries(lr.audits).slice(0, 200)) {
    const s = summarizeAudit(id, audit);
    if (s) audits.push(s);
  }
  const byId = new Map(audits.map((a) => [a.id, a]));
  const pick = (field) => {
    const a = byId.get(LAB_METRIC_AUDITS[field]);
    if (!a || a.numericValue === null) return null;
    return a.numericValue;
  };
  return {
    score,
    score100: Math.round(score * 100),
    fcpMs: pick("fcpMs"),
    lcpMs: pick("lcpMs"),
    tbtMs: pick("tbtMs"),
    cls: pick("cls"),
    speedIndexMs: pick("speedIndexMs"),
    interactiveMs: pick("interactiveMs"),
    serverResponseMs: pick("serverResponseMs"),
    // Lab INP only when Lighthouse itself returns this audit; otherwise
    // null. Lab TBT is a different metric and is never substituted here.
    inpMs: pick("inpMs"),
    fetchTime: capString(lr.fetchTime, 100),
    finalUrl: capString(lr.finalUrl, 2048),
    audits,
    auditCount: audits.length,
  };
}

// ---- Chrome UX Report (field) -------------------------------------------
// Request: POST records:queryRecord?key=<key> with body
//   { url | origin, formFactor: "PHONE"|"DESKTOP",
//     metrics: ["largest_contentful_paint","interaction_to_next_paint",
//               "cumulative_layout_shift"] }.
// Response: record.metrics.<name>.percentiles.p75 plus histogram buckets
// (accepted under either the "histogram" or "distributions" key and
// normalized to distributions) and record.collectionPeriod. A response
// with no record object means NO_FIELD_DATA, never zero metrics.
const CRUX_METRICS = {
  lcp: "largest_contentful_paint",
  inp: "interaction_to_next_paint",
  cls: "cumulative_layout_shift",
};

function normalizeDistributions(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const bucket of raw.slice(0, 20)) {
    if (!isPlainObject(bucket)) continue;
    const density = finiteNumber(bucket.density) ?? finiteNumber(bucket.proportion);
    if (density === null) continue;
    out.push({
      start: finiteNumber(bucket.start),
      end: finiteNumber(bucket.end),
      density,
    });
  }
  return out.length > 0 ? out : null;
}

function parseCruxRecord(record) {
  if (!isPlainObject(record) || !isPlainObject(record.metrics)) {
    throw new ProviderError("NO_FIELD_DATA", SAFE.NO_FIELD_DATA);
  }
  const metrics = {};
  let anyMetric = false;
  for (const [short, key] of Object.entries(CRUX_METRICS)) {
    const m = record.metrics[key];
    if (!isPlainObject(m)) { metrics[short] = { p75: null, distributions: null }; continue; }
    const p75 = isPlainObject(m.percentiles) ? finiteNumber(m.percentiles.p75) : null;
    const distributions = normalizeDistributions(m.histogram ?? m.distributions);
    if (p75 !== null || distributions !== null) anyMetric = true;
    metrics[short] = { p75, distributions };
  }
  if (!anyMetric) throw new ProviderError("NO_FIELD_DATA", SAFE.NO_FIELD_DATA);
  const cp = isPlainObject(record.collectionPeriod) ? record.collectionPeriod : null;
  const datePart = (d) =>
    isPlainObject(d) && Number.isInteger(d.year) && Number.isInteger(d.month) && Number.isInteger(d.day)
      ? { year: d.year, month: d.month, day: d.day }
      : null;
  return {
    metrics: {
      lcp: { p75Ms: metrics.lcp.p75, classification: classifyLcp(metrics.lcp.p75), distributions: metrics.lcp.distributions },
      inp: { p75Ms: metrics.inp.p75, classification: classifyInp(metrics.inp.p75), distributions: metrics.inp.distributions },
      cls: { p75: metrics.cls.p75, classification: classifyCls(metrics.cls.p75), distributions: metrics.cls.distributions },
    },
    collectionPeriod: cp
      ? { firstDate: datePart(cp.firstDate), lastDate: datePart(cp.lastDate) }
      : null,
  };
}

export async function fetchCrux({ target, scope, formFactor, apiKey, fetchFn = fetch }) {
  if (!apiKey) throw new ProviderError("NOT_CONFIGURED", SAFE.NOT_CONFIGURED);
  const url = new URL(CRUX_ENDPOINT);
  url.searchParams.set("key", apiKey);
  const body = {
    formFactor,
    metrics: Object.values(CRUX_METRICS),
  };
  if (scope === "origin") body.origin = target;
  else body.url = target;
  const response = await callProvider(
    url.toString(),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    fetchFn,
  );
  if (!response.ok) throw mapHttpError(response.status, "crux");
  let json;
  try {
    json = JSON.parse(await readCappedText(response, fetchFn));
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError("INVALID_RESPONSE", SAFE.INVALID_RESPONSE);
  }
  if (!isPlainObject(json) || !isPlainObject(json.record)) {
    throw new ProviderError("NO_FIELD_DATA", SAFE.NO_FIELD_DATA);
  }
  return { scope, formFactor, ...parseCruxRecord(json.record) };
}
