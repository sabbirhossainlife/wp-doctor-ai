// Public email-domain DNS checks (Tool 07, Source B). Server-side only,
// bounded, and resolver-injectable so core rules never depend on public
// DNS availability in tests. This module NEVER sends email, NEVER opens
// an SMTP connection, and NEVER queries anything but the validated public
// email domain (and its _dmarc / _domainkey subdomains).
// Bounds: 5 s per query, at most 3 queries (SPF, DMARC, DKIM) run
// sequentially, max 50 TXT records per hostname, each record excerpt
// capped at 512 characters. A timeout or failure degrades ONLY that
// check (EMAIL_DNS_LOOKUP_FAILED / PARTIAL); other findings are kept.
import dns from "node:dns/promises";
import { isPublicDomain, isValidDkimSelector } from "./domain.js";

export const DNS_TIMEOUT_MS = 5000;
export const DNS_MAX_RECORDS = 50;
export const DNS_EXCERPT_MAX = 512;

function excerpt(record) {
  const text = typeof record === "string" ? record : "";
  return text.length > DNS_EXCERPT_MAX ? text.slice(0, DNS_EXCERPT_MAX) : text;
}

function flattenTxt(records) {
  const out = [];
  if (!Array.isArray(records)) return out;
  for (const record of records) {
    if (Array.isArray(record)) out.push(record.join(""));
    else if (typeof record === "string") out.push(record);
    if (out.length >= DNS_MAX_RECORDS) break;
  }
  return out;
}

async function lookupTxt(resolver, hostname) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("DNS_TIMEOUT")), DNS_TIMEOUT_MS);
  });
  const result = await Promise.race([resolver(hostname), timeout]);
  return flattenTxt(result);
}

function defaultResolver(hostname) {
  return dns.resolveTxt(hostname);
}

const SPF_LIKE = /(include:|ip4:|ip6:|\ball\b|\bmx\b|\ba\b)/i;

export function analyzeSpf(records) {
  const trimmed = records.map((r) => r.trim());
  const spf = trimmed.filter((r) => r.toLowerCase().startsWith("v=spf1"));
  const empty = trimmed.some((r) => r === "");
  const spfLikeWithoutTag = trimmed.some((r) => !r.toLowerCase().startsWith("v=spf1") && SPF_LIKE.test(r));
  const anomalies = [];
  if (spf.length > 1) anomalies.push("multiple-spf-records");
  if (empty) anomalies.push("empty-txt-record");
  if (spfLikeWithoutTag) anomalies.push("spf-like-record-without-version-tag");
  if (spf.length === 0) {
    return { status: "MISSING", recordCount: trimmed.length, spfRecord: null, anomalies, excerpt: trimmed.slice(0, 3).map(excerpt) };
  }
  if (anomalies.length > 0) {
    return { status: "SYNTAX_WARNING", recordCount: trimmed.length, spfRecord: excerpt(spf[0]), anomalies, excerpt: trimmed.slice(0, 3).map(excerpt) };
  }
  return { status: "PRESENT", recordCount: trimmed.length, spfRecord: excerpt(spf[0]), anomalies, excerpt: trimmed.slice(0, 3).map(excerpt) };
}

export function analyzeDmarc(records) {
  const trimmed = records.map((r) => r.trim());
  const dmarc = trimmed.filter((r) => r.toLowerCase().startsWith("v=dmarc1"));
  if (dmarc.length === 0) {
    return { status: "MISSING", policy: null, recordCount: trimmed.length, dmarcRecord: null, anomalies: [], excerpt: trimmed.slice(0, 3).map(excerpt) };
  }
  if (dmarc.length > 1) {
    return { status: "MULTIPLE", policy: null, recordCount: trimmed.length, dmarcRecord: excerpt(dmarc[0]), anomalies: ["multiple-dmarc-records"], excerpt: trimmed.slice(0, 3).map(excerpt) };
  }
  const record = dmarc[0];
  const tags = {};
  for (const part of record.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) tags[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim().toLowerCase();
  }
  const policy = tags.p ?? null;
  if (!["none", "quarantine", "reject"].includes(policy)) {
    return { status: "INVALID", policy: policy ?? null, recordCount: trimmed.length, dmarcRecord: excerpt(record), anomalies: ["missing-or-unknown-p-tag"], excerpt: trimmed.slice(0, 3).map(excerpt) };
  }
  return { status: "PRESENT", policy, recordCount: trimmed.length, dmarcRecord: excerpt(record), anomalies: [], excerpt: trimmed.slice(0, 3).map(excerpt) };
}

// Returns { spf, dmarc, dkim, dnsFailed }. dkim is null when no valid
// selector is available (NOT_CHECKED — never guessed, never "missing").
export async function runEmailDnsChecks(emailDomain, dkimSelector, deps = {}) {
  const resolver = deps.resolver ?? defaultResolver;
  if (!isPublicDomain(emailDomain)) {
    return {
      spf: { status: "NOT_CHECKED", reason: "INVALID_DOMAIN" },
      dmarc: { status: "NOT_CHECKED", reason: "INVALID_DOMAIN" },
      dkim: { status: "NOT_CHECKED", reason: "INVALID_DOMAIN" },
      dnsFailed: false,
    };
  }
  let spf = null;
  let dmarc = null;
  let dnsFailed = false;
  try {
    spf = analyzeSpf(await lookupTxt(resolver, emailDomain));
  } catch {
    spf = { status: "LOOKUP_FAILED", recordCount: null, spfRecord: null, anomalies: [], excerpt: [] };
    dnsFailed = true;
  }
  try {
    dmarc = analyzeDmarc(await lookupTxt(resolver, `_dmarc.${emailDomain}`));
  } catch {
    dmarc = { status: "LOOKUP_FAILED", recordCount: null, dmarcRecord: null, policy: null, anomalies: [], excerpt: [] };
    dnsFailed = true;
  }
  let dkim = null;
  if (!dkimSelector) {
    dkim = { status: "NOT_CHECKED", reason: "SELECTOR_UNKNOWN", selector: null };
  } else if (!isValidDkimSelector(dkimSelector)) {
    dkim = { status: "NOT_CHECKED", reason: "SELECTOR_INVALID", selector: null };
  } else {
    try {
      const records = await lookupTxt(resolver, `${dkimSelector}._domainkey.${emailDomain}`);
      dkim = {
        status: records.length > 0 ? "PRESENT" : "NOT_FOUND",
        selector: dkimSelector,
        recordCount: records.length,
        excerpt: records.slice(0, 1).map(excerpt),
      };
    } catch {
      dkim = { status: "LOOKUP_FAILED", selector: dkimSelector, recordCount: null, excerpt: [] };
      dnsFailed = true;
    }
  }
  return { spf, dmarc, dkim, dnsFailed };
}
