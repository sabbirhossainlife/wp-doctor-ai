// Structured scanner errors. User-facing messages are deliberately generic:
// they never contain stack traces, raw infrastructure errors, credentials,
// tokens, cookies, full headers, or query strings.
export const SCANNER_ERROR_CODES = Object.freeze([
  "INVALID_URL",
  "UNSUPPORTED_SCHEME",
  "UNSUPPORTED_PORT",
  "PROHIBITED_DESTINATION",
  "DNS_FAILURE",
  "CONNECTION_FAILURE",
  "TLS_FAILURE",
  "REQUEST_TIMEOUT",
  "TOO_MANY_REDIRECTS",
  "RESPONSE_LIMIT_EXCEEDED",
  "RATE_LIMITED",
  "CONCURRENCY_LIMIT_REACHED",
  "INTERNAL_SCANNER_ERROR",
]);

const SAFE_MESSAGES = {
  INVALID_URL: "The URL is missing, malformed, or cannot be normalized safely.",
  UNSUPPORTED_SCHEME: "Only http and https URLs are supported.",
  UNSUPPORTED_PORT:
    "Only the standard ports are supported (80 for http, 443 for https).",
  PROHIBITED_DESTINATION:
    "The destination is not a publicly reachable address.",
  DNS_FAILURE: "The hostname could not be resolved safely.",
  CONNECTION_FAILURE: "The connection to the destination failed.",
  TLS_FAILURE: "The TLS certificate for the destination could not be verified.",
  REQUEST_TIMEOUT: "The request timed out.",
  TOO_MANY_REDIRECTS: "Too many redirects, or a redirect loop was detected.",
  RESPONSE_LIMIT_EXCEEDED: "The response exceeded the permitted size.",
  RATE_LIMITED: "Too many scan requests. Please try again later.",
  CONCURRENCY_LIMIT_REACHED:
    "Too many scans are running at once. Please try again later.",
  INTERNAL_SCANNER_ERROR: "The scan could not be completed.",
};

export class ScannerError extends Error {
  constructor(code, detail) {
    const safeCode = SCANNER_ERROR_CODES.includes(code)
      ? code
      : "INTERNAL_SCANNER_ERROR";
    super(SAFE_MESSAGES[safeCode]);
    this.name = "ScannerError";
    this.code = safeCode;
    // Internal detail is for server-side diagnostics only. It must never be
    // sent to a client or written to a user-visible log unredacted.
    this.detail = detail || null;
  }

  toSafeObject() {
    return { code: this.code, message: this.message };
  }
}

export function asScannerError(error) {
  if (error instanceof ScannerError) return error;
  return new ScannerError("INTERNAL_SCANNER_ERROR", String(error));
}

// Redact a URL for logs/results: host + path only, never the query string
// (which may carry secrets) and never credentials (which are rejected anyway).
export function redactUrlForLog(urlString) {
  try {
    const parsed = new URL(urlString);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}
