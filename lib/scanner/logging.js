// Structured, redacted scan logging. One JSON line per scan attempt with
// the hostname only — never the query string, headers, cookies, tokens,
// credentials, or resolved IPs (the IP is an operational detail that a
// log reader does not need, and query strings may carry secrets).
import { redactUrlForLog } from "./errors.js";

export function logScanEvent(event) {
  const record = {
    event: "scanner",
    outcome: event.outcome,
    code: event.code || null,
    status: event.status ?? null,
    target: event.url ? redactUrlForLog(event.url) : null,
    host: event.host || null,
    redirects: event.redirects ?? 0,
    durationMs: event.durationMs ?? null,
  };
  console.log(JSON.stringify(record));
}
