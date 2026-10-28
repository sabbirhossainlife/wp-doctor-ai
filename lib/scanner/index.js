// Public surface of the internal scanner library (Milestone 2).
// Since Milestone 3, Tool 01 wires it behind authentication via
// lib/scans.js (never directly from a route, never exposed publicly).
export { ScannerError, SCANNER_ERROR_CODES, redactUrlForLog } from "./errors.js";
export { parseScanTarget, SCANNER_MAX_URL_LENGTH } from "./url-policy.js";
export { classifyAddress, isPublicAddress } from "./ip-policy.js";
export {
  resolveAndValidate,
  defaultResolver,
  DEFAULT_DNS_TIMEOUT_MS,
} from "./dns.js";
export { pinnedRequest, SCANNER_USER_AGENT } from "./transport.js";
export { ScanLimiter, MapStore } from "./rate-limit.js";
export { logScanEvent } from "./logging.js";
export { scanUrl, SCANNER_LIMITS } from "./scanner.js";
