// Tool 08 vulnerability-intelligence provider adapter (Milestone 12).
// Architecture: transport (fetch, injected for tests) -> provider parsing
// (WPVulnerability JSON) -> normalized advisory -> version matching (in
// versions.js) -> findings (in rules.js). Providers are replaceable: a new
// provider implements `queryComponent(productType, slugOrVersion)` returning
// { status, advisories } and registers under a providerId. Only the fixed
// official host below is ever contacted; base URLs are NEVER user-supplied
// and are NEVER taken from client input, snapshots, or advisory payloads.
//
// Active provider: WPVulnerability (www.wpvulnerability.net). Verified
// 2026-10-28: keyless core/plugin/theme endpoints, "100% open and free
// API", licensing page asks for a link back to WPVulnerability and/or the
// source (attribution is shown in reports) and notes EUPL v1.2 work. No
// published rate limit was found, so this adapter imposes its own bounds.
// WPScan is deliberately NOT an active provider: its free tier is
// non-commercial only and commercial SaaS use requires a paid Enterprise
// licence + token, neither of which exists for this project. Configuring
// VULNERABILITY_PROVIDER=wpscan therefore yields PROVIDER_UNAVAILABLE
// with that explanation, never a silent fallback.
// Storage policy: only minimal advisory references are persisted (uuid,
// title, affected range in provider representation, fixed version only
// where derivable, CVSS score/severity only when supplied, source ids/
// links/dates only when supplied, retrieval timestamp). Full provider
// responses are never stored or redistributed.
import { matchVersionRange, deriveFixedVersion, isStandardVersion } from "./versions.js";

export const WPVULNERABILITY_HOST = "www.wpvulnerability.net";
export const WPVULNERABILITY_BASE = `https://${WPVULNERABILITY_HOST}`;
export const PROVIDER_ID = "wpvulnerability";

export const PROVIDER_LIMITS = Object.freeze({
  timeoutMs: 8000,
  maxResponseBytes: 512 * 1024,
  maxComponents: 60,
  concurrency: 2,
  maxAdvisoriesPerComponent: 200,
});

export function providerConfig(env = process.env) {
  const name = (env.VULNERABILITY_PROVIDER ?? "wpvulnerability").trim().toLowerCase();
  const timeoutMs = Number.parseInt(env.VULNERABILITY_PROVIDER_TIMEOUT_MS ?? "", 10);
  const maxComponents = Number.parseInt(env.VULNERABILITY_MAX_COMPONENTS ?? "", 10);
  const concurrency = Number.parseInt(env.VULNERABILITY_PROVIDER_CONCURRENCY ?? "", 10);
  const maxResponseBytes = Number.parseInt(env.VULNERABILITY_MAX_RESPONSE_BYTES ?? "", 10);
  return {
    name,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : PROVIDER_LIMITS.timeoutMs,
    maxComponents: Number.isFinite(maxComponents) && maxComponents > 0 ? maxComponents : PROVIDER_LIMITS.maxComponents,
    maxAdvisoriesPerComponent: PROVIDER_LIMITS.maxAdvisoriesPerComponent,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : PROVIDER_LIMITS.concurrency,
    maxResponseBytes: Number.isFinite(maxResponseBytes) && maxResponseBytes > 0 ? maxResponseBytes : PROVIDER_LIMITS.maxResponseBytes,
  };
}

export function isSupportedProviderName(name) {
  return name === PROVIDER_ID;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const VERSION_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function cap(value, max) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function firstCveId(sources) {
  for (const s of sources) {
    if (s && typeof s.id === "string" && /^CVE-\d{4}-\d{4,}$/i.test(s.id)) return s.id.toUpperCase();
  }
  return null;
}

function cvssOf(vuln) {
  // impact may be an array-like object or array; only genuinely supplied
  // scores are kept. The docs show cvss under impact with score/severity.
  const impact = vuln?.impact;
  if (!impact || typeof impact !== "object") return { score: null, severity: null };
  const cvss = impact.cvss ?? (Array.isArray(impact) ? impact.find((x) => x && x.cvss)?.cvss : null);
  if (!cvss || typeof cvss !== "object") return { score: null, severity: null };
  const score = cvss.score !== null && cvss.score !== undefined && cvss.score !== "" ? Number(cvss.score) : null;
  const severity = typeof cvss.severity === "string" && cvss.severity !== "" ? cvss.severity.slice(0, 20) : null;
  return { score: Number.isFinite(score) ? score : null, severity };
}

// Normalize one provider vulnerability entry. Returns null when the entry
// is unusable (no uuid/name). No field is ever invented: absent CVSS,
// dates, CVE ids, or fixed versions stay null.
export function normalizeWpvulnerabilityAdvisory(entry, { productType, slug }) {
  if (!entry || typeof entry !== "object") return null;
  const uuid = typeof entry.uuid === "string" && entry.uuid !== "" ? entry.uuid.slice(0, 128) : null;
  const title = typeof entry.name === "string" && entry.name !== "" ? entry.name.slice(0, 300) : null;
  if (!uuid && !title) return null;
  const sources = Array.isArray(entry.source) ? entry.source : [];
  const sourceLinks = sources
    .filter((s) => s && typeof s.link === "string" && s.link.startsWith("https://"))
    .slice(0, 5)
    .map((s) => ({ id: typeof s.id === "string" ? s.id.slice(0, 100) : null, link: s.link.slice(0, 500), date: typeof s.date === "string" ? s.date.slice(0, 20) : null }));
  const { score, severity } = cvssOf(entry);
  const operator = entry.operator && typeof entry.operator === "object" ? entry.operator : null;
  return {
    providerId: PROVIDER_ID,
    advisoryId: uuid ?? title,
    cveId: firstCveId(sources),
    title,
    summary: typeof entry.description === "string" && entry.description !== "" ? entry.description.slice(0, 500) : null,
    productType,
    slug,
    range: operator
      ? {
          minVersion: operator.min_version !== null && operator.min_version !== undefined ? String(operator.min_version).slice(0, 50) : null,
          minOperator: typeof operator.min_operator === "string" ? operator.min_operator.slice(0, 10) : null,
          maxVersion: operator.max_version !== null && operator.max_version !== undefined ? String(operator.max_version).slice(0, 50) : null,
          maxOperator: typeof operator.max_operator === "string" ? operator.max_operator.slice(0, 10) : null,
          unfixed: String(operator.unfixed ?? "0") === "1",
        }
      : null,
    fixedVersion: operator ? deriveFixedVersion(operator) : null,
    cvssScore: score,
    cvssSeverity: severity,
    sourceUrl: sourceLinks.length > 0 ? sourceLinks[0].link : null,
    sourceLinks,
    publishedDate: sourceLinks.find((s) => s.date)?.date ?? null,
    operatorRaw: operator,
  };
}

export function parseWpvulnerabilityResponse(json, { productType, slug }) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { status: "PROVIDER_ERROR", advisories: [], reason: "MALFORMED_RESPONSE" };
  if (json.error !== 0 && json.error !== "0") return { status: "PROVIDER_ERROR", advisories: [], reason: "PROVIDER_ERROR_FLAG" };
  const data = json.data;
  if (data === null || data === undefined) return { status: "PROVIDER_ERROR", advisories: [], reason: "MISSING_DATA" };
  const list = Array.isArray(data.vulnerability) ? data.vulnerability : null;
  // Unknown slug: provider returns vulnerability: null with error 0 — that
  // is "no advisories returned for this component", not an error, and not
  // proof the component is safe. The service records it as
  // NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES only when the component
  // identity itself was certain (known slug); unknown slugs are handled
  // by the caller before querying.
  if (list === null) return { status: "OK", advisories: [], reason: "NO_VULNERABILITIES_RETURNED" };
  const advisories = list.slice(0, PROVIDER_LIMITS.maxAdvisoriesPerComponent)
    .map((e) => normalizeWpvulnerabilityAdvisory(e, { productType, slug }))
    .filter(Boolean);
  return { status: "OK", advisories, reason: null };
}

export class ProviderError extends Error {
  constructor(status, reason) {
    super(reason);
    this.name = "ProviderError";
    this.status = status; // PROVIDER_UNAVAILABLE | PROVIDER_RATE_LIMITED | PROVIDER_ERROR
    this.reason = reason;
  }
}

function providerPath(productType, key) {
  if (productType === "core") return `/core/${encodeURIComponent(key)}/`;
  if (productType === "plugin") return `/plugin/${encodeURIComponent(key)}/`;
  if (productType === "theme") return `/theme/${encodeURIComponent(key)}/`;
  throw new ProviderError("PROVIDER_ERROR", "UNKNOWN_PRODUCT_TYPE");
}

// Transport is injectable: fetchFn(url, { timeoutMs }) -> { status, text }.
// Production fetchFn uses global fetch with AbortSignal + size cap.
export async function defaultProviderFetch(url, { timeoutMs, maxResponseBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json", "user-agent": "WP-Doctor-AI-Security-Scanner/1.0" } });
    const text = await res.text();
    if (text.length > maxResponseBytes) throw new ProviderError("PROVIDER_ERROR", "RESPONSE_TOO_LARGE");
    return { status: res.status, text };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err?.name === "AbortError") throw new ProviderError("PROVIDER_ERROR", "TIMEOUT");
    throw new ProviderError("PROVIDER_ERROR", "FETCH_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

// Query one component. Core: key = installed core version (version-specific
// endpoint — every returned advisory is a match for that version).
// Plugin/theme: key = canonical slug; matching happens locally in
// matchAdvisories (the provider returns all advisories for the slug).
export async function queryWpvulnerability(productType, key, { fetchFn = defaultProviderFetch, config = providerConfig() } = {}) {
  if (productType === "core") {
    if (!VERSION_PATH_PATTERN.test(key)) throw new ProviderError("PROVIDER_ERROR", "INVALID_CORE_VERSION");
  } else {
    if (!SLUG_PATTERN.test(key)) throw new ProviderError("PROVIDER_ERROR", "INVALID_SLUG");
  }
  const url = WPVULNERABILITY_BASE + providerPath(productType, key);
  let res;
  try {
    res = await fetchFn(url, { timeoutMs: config.timeoutMs, maxResponseBytes: config.maxResponseBytes });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError("PROVIDER_ERROR", "FETCH_FAILED");
  }
  if (res.status === 429) throw new ProviderError("PROVIDER_RATE_LIMITED", "RATE_LIMITED");
  if (res.status === 401 || res.status === 403) throw new ProviderError("PROVIDER_ERROR", "PROVIDER_AUTH_FAILURE");
  if (res.status < 200 || res.status >= 300) throw new ProviderError("PROVIDER_ERROR", `HTTP_${res.status}`);
  let json;
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new ProviderError("PROVIDER_ERROR", "MALFORMED_JSON");
  }
  const parsed = parseWpvulnerabilityResponse(json, { productType, slug: productType === "core" ? null : key });
  if (parsed.status !== "OK") throw new ProviderError("PROVIDER_ERROR", parsed.reason);
  return { advisories: parsed.advisories, retrievedAt: new Date().toISOString() };
}

// Match normalized advisories against an installed component. Returns
// { status, matched: [], insufficient: [] } where status is one of the
// Tool 08 component statuses. Core components pass matched=true via the
// version-specific endpoint (every returned advisory matches that version).
export function matchAdvisories(component, advisories) {
  const { productType, slug, version } = component;
  if (!version) return { status: "COMPONENT_VERSION_UNKNOWN", matched: [], insufficient: [] };
  if (!isStandardVersion(version)) return { status: "COMPONENT_VERSION_UNKNOWN", matched: [], insufficient: [] };
  if (productType === "core") {
    if (advisories.length > 0) return { status: "MATCHED_ADVISORY", matched: advisories, insufficient: [] };
    return { status: "NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES", matched: [], insufficient: [] };
  }
  if (!slug || !SLUG_PATTERN.test(slug)) return { status: "COMPONENT_IDENTITY_UNCERTAIN", matched: [], insufficient: [] };
  const matched = [];
  const insufficient = [];
  for (const advisory of advisories) {
    const result = matchVersionRange(version, advisory.operatorRaw);
    if (result.insufficient) insufficient.push({ advisoryId: advisory.advisoryId, reason: result.reason });
    else if (result.matched) matched.push(advisory);
  }
  if (matched.length > 0) return { status: "MATCHED_ADVISORY", matched, insufficient };
  if (insufficient.length > 0 && advisories.length === insufficient.length) {
    return { status: "INSUFFICIENT_EVIDENCE", matched: [], insufficient };
  }
  return { status: "NO_MATCHING_ADVISORY_IN_CHECKED_SOURCES", matched: [], insufficient };
}
