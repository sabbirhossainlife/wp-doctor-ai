// Server-side redaction for user-supplied symptom text (Milestone 6).
// Error excerpts and symptom descriptions are UNTRUSTED: they may contain
// pasted secrets. Obvious secret patterns are replaced before storage;
// the redacted text is what is stored and rendered (escaped by React).
// This is a best-effort guard, not a guarantee — users are warned in the
// UI not to paste passwords, keys, or tokens.

const SECRET_PATTERNS = [
  /(password|passwd|pwd|api[_-]?key|secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*[^\s,;]+/gi,
  /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/g,
  /(sk-[A-Za-z0-9]{8,})/g,
];

export function redactSecrets(text) {
  if (typeof text !== "string") return text;
  let out = text;
  out = out.replace(SECRET_PATTERNS[0], "$1=[redacted]");
  out = out.replace(SECRET_PATTERNS[1], "Bearer [redacted]");
  out = out.replace(SECRET_PATTERNS[2], "[redacted]");
  return out;
}
