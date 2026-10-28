# AI Diagnostics — Milestone 4

AI explanations are an **interpretation layer** over Tool 01's deterministic
scan reports. The scanner findings are the source of truth and are never
modified, overwritten, or replaced by AI output. The AI section on a report
page is visually and textually separated from the verified findings.

## Flow

1. User runs a Tool 01 scan (deterministic, persisted).
2. User explicitly clicks **Generate AI explanation** on a terminal scan
   (COMPLETED / FAILED / BLOCKED). AI is never called automatically per scan.
3. The server verifies the session and scan ownership, loads the scan and
   findings **from the database only** (client-supplied evidence is ignored),
   builds a minimized input, calls the configured provider, validates the
   output, checks every finding reference, and persists the result.
4. A saved successful analysis is returned on repeat visits; regeneration
   requires an explicit `{ regenerate: true }` request (no double-charge
   from double-clicks).

## Provider configuration (server-side only)

| Variable | Meaning |
|---|---|
| `AI_PROVIDER` | `"openai"` to enable; anything else (or unset) means unconfigured |
| `OPENAI_API_KEY` | OpenAI API key — server-side only, never sent to the browser or logs |
| `OPENAI_MODEL` | Model identifier — **must come from the environment**; no model id is hardcoded |
| `AI_TIMEOUT_MS` | Provider timeout, default 30000 |
| `AI_MAX_OUTPUT_TOKENS` | Output token cap, default 2000 |

Current status: **no live key is configured**, so the API honestly returns
503 `AI_NOT_CONFIGURED` and the UI shows a not-configured state while the
deterministic report remains fully readable. **No live provider request was
executed in this milestone**; all provider tests use a controlled mock.
Do not claim live integration was tested until a real key is configured and
a real call is observed.

## Adapter

`lib/ai/providers.js` exposes `analyze(messages)` behind a provider-neutral
interface. The OpenAI adapter uses Chat Completions with
`response_format: { type: "json_schema", json_schema: { strict: true } }`
(checked against OpenAI's structured-output documentation: every field is
required and `additionalProperties: false` throughout). Provider schema
conformance does **not** replace local validation — every response is
re-validated by `lib/ai/schema.js` + `lib/ai/validate.js`.

## Input minimization and redaction

`lib/ai/input.js` sends only: execution status, diagnostic outcome, HTTP
status, duration, redirect count, error code, redacted target/final URLs
(protocol + hostname + path), and sanitized findings (title, description,
severity, status, recommendation, bounded evidence summaries). Total input
is capped at 8000 characters. Never sent: user ids, emails, passwords,
cookies, tokens, API keys, auth headers, credentials, raw bodies, internal
IPs, personal data, query strings, fragments, database connection info,
stack traces. No browsing, shell, database, filesystem, or repair tools are
given to the model, and the AI service makes no second outbound website
request. Unavailable checks are stated explicitly in the input: no TLS
detail, no plugin/theme data, no body content, no server logs.

## Output schema and validation policy

Schema version `"1"` (see `lib/ai/schema.js` for caps): summary,
explanation, qualitative `diagnosticConfidence` (LOW/MEDIUM/HIGH — never a
numeric probability), `confirmedObservations` (each must reference a real
finding id), `causeHypotheses` (title, explanation, confidence, supporting
finding ids, additional evidence required), `recommendedActions` (title,
explanation, priority, risk level, skill level, steps, referenced finding
ids, human-review flag — safe, non-destructive steps only), `missingEvidence`,
`limitations`, `humanReviewRecommended`.

Validation policy: unknown fields are an **error**, not stripped. Any
unknown or duplicate finding reference rejects the **whole** analysis as
`INVALID_OUTPUT` (references are never silently dropped). Heuristic claim
guardrails reject TLS-validity claims (the scanner collects no TLS detail),
named-plugin-as-confirmed-cause claims (no plugin data collected), and
dangerous actions (deleting files, `rm -rf`, dropping tables, permanently
disabling security controls, sharing credentials, live database edits).
Invalid output is persisted only as a FAILED row with a sanitized error
code — never as a success.

## Prompt-injection defenses — and their limits

- Trusted system instruction is a separate message from the evidence;
  evidence is serialized JSON explicitly labelled untrusted data.
- Data minimization: only the fields above reach the model.
- Strict output validation + reference checks (above).
- No tools, no code execution, no privileged actions from model output.
- Server-side authorization: the model cannot change which scan or user
  the request belongs to.

Passing the Milestone 4 injection tests does **not** prove immunity to all
prompt injection. A sufficiently clever model output that stays inside the
schema and references real findings could still mislead; that is why the UI
labels AI output as interpretation and why `humanReviewRecommended` exists.
Treat AI explanations as untrusted advice, never as verified fact.

## Usage limits and cost controls

- Explicit user trigger only; no automatic analysis per scan.
- One completed analysis per scan; regeneration is explicit.
- Per-user limit: 10 provider call attempts per day (in-memory,
  single-process only — a shared store is the production replacement).
- Input cap 8000 chars, output token cap (default 2000), response cap
  64 KiB, provider timeout (default 30 s).
- Failed attempts persist a FAILED row so retries are deliberate, not
  automatic billable retries.

## API

`POST /api/scans/[id]/ai-analysis` — 401 unauthenticated, 404
nonexistent-or-not-yours (identical), 409 scan not in a terminal state,
429 rate limit, 503 `AI_NOT_CONFIGURED`, 502 provider timeout / provider
error / refusal / invalid output, 500 persistence failure. All errors use
safe messages; no stack traces, secrets, or provider response bodies.
`GET /api/scans/[id]/ai-analysis` returns the saved analysis under the same
ownership rules.

## Known limitations

- No live provider integration tested (no key configured).
- Browser (Playwright) E2E not run (no browser binary in this VM); UI
  states are verified at HTTP level, and the completed-analysis UI has
  only been exercised via the validated persisted shape, not by clicking
  in a browser.
- Rate limiter is in-memory and single-process only.
- Claim guardrails are heuristics, not a grounding proof.
- AI explanations are never guaranteed correct.
