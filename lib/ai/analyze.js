// AI analysis service (Milestone 4). Owns the generate → validate → persist
// pipeline. The deterministic Scan + ScanFinding rows are the source of
// truth and are never modified here. The provider is injectable ONLY as a
// function parameter (tests); production routes use the configured provider
// and never a mock.

import { buildAiInput } from "./input.js";
import { validateAnalysis, AiValidationError } from "./validate.js";
import { AiProviderError, OpenAiProvider } from "./providers.js";
import { sharedAiRateLimiter } from "./rate-limit.js";

const PLACEHOLDER_VALUES = new Set([
  "",
  "your-ai-provider-name",
  "your-ai-api-key-here",
  "your-openai-api-key-here",
  "change-me",
]);

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getAiConfig(env = process.env) {
  return {
    provider: typeof env.AI_PROVIDER === "string" ? env.AI_PROVIDER.trim().toLowerCase() : "",
    apiKey: typeof env.OPENAI_API_KEY === "string" ? env.OPENAI_API_KEY.trim() : "",
    model: typeof env.OPENAI_MODEL === "string" ? env.OPENAI_MODEL.trim() : "",
    timeoutMs: parsePositiveInt(env.AI_TIMEOUT_MS, 30000),
    maxOutputTokens: parsePositiveInt(env.AI_MAX_OUTPUT_TOKENS, 2000),
  };
}

// Configured = provider + key + model all present and not placeholders.
// The model identifier is never hardcoded: it must come from OPENAI_MODEL.
export function isAiConfigured(config) {
  if (!config || config.provider !== "openai") return false;
  if (PLACEHOLDER_VALUES.has(config.apiKey) || PLACEHOLDER_VALUES.has(config.model)) return false;
  return Boolean(config.apiKey && config.model);
}

export function buildProvider(config) {
  if (!isAiConfigured(config)) {
    throw new AiProviderError("AI_NOT_CONFIGURED", "AI is not configured.");
  }
  return new OpenAiProvider({
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens,
  });
}

export function publicAnalysis(row) {
  if (!row) return null;
  return {
    id: row.id,
    scanId: row.scanId,
    status: row.status,
    provider: row.provider,
    model: row.model,
    schemaVersion: row.schemaVersion,
    analysis: row.analysis,
    errorCode: row.errorCode,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

// prisma: Prisma client. scan: Scan row (ownership already verified by the
// caller). findings: its ScanFinding rows. userId: verified session user.
// providerOverride: test injection only. Returns the public analysis object.
// Throws AiProviderError / AiValidationError; on provider/validation failure
// a FAILED row is persisted (retryable) and the error is rethrown.
export async function generateAiAnalysis({
  prisma,
  scan,
  findings,
  userId,
  regenerate = false,
  providerOverride = null,
  limiter = sharedAiRateLimiter,
  config = getAiConfig(),
}) {
  const existing = await prisma.aiAnalysis.findUnique({ where: { scanId: scan.id } });
  if (existing && existing.status === "COMPLETED" && !regenerate) {
    return { ...publicAnalysis(existing), fromCache: true };
  }
  if (existing && existing.status === "RUNNING") {
    throw new AiProviderError("ALREADY_RUNNING", "An AI analysis is already running for this scan.");
  }

  const provider = providerOverride || buildProvider(config);
  limiter.check(userId);
  limiter.record(userId);
  const input = buildAiInput(scan, findings);
  try {
    const { provider: providerName, model, analysis } = await provider.analyze(input);
    const validated = validateAnalysis(analysis, findings.map((f) => f.id));
    const saved = await prisma.aiAnalysis.upsert({
      where: { scanId: scan.id },
      create: {
        scanId: scan.id,
        status: "COMPLETED",
        provider: providerName,
        model,
        schemaVersion: validated.schemaVersion,
        analysis: validated,
        errorCode: null,
        completedAt: new Date(),
      },
      update: {
        status: "COMPLETED",
        provider: providerName,
        model,
        schemaVersion: validated.schemaVersion,
        analysis: validated,
        errorCode: null,
        completedAt: new Date(),
      },
    });
    return { ...publicAnalysis(saved), fromCache: false };
  } catch (err) {
    const code =
      err instanceof AiValidationError ? "INVALID_OUTPUT"
      : err instanceof AiProviderError ? err.code
      : "PROVIDER_ERROR";
    // Persist a FAILED row (sanitized code only) so the UI can offer retry.
    // A persistence failure here must not mask the original error.
    try {
      await prisma.aiAnalysis.upsert({
        where: { scanId: scan.id },
        create: {
          scanId: scan.id,
          status: "FAILED",
          provider: provider?.providerName || "unknown",
          model: provider?.model || null,
          schemaVersion: "1",
          analysis: null,
          errorCode: code,
          completedAt: null,
        },
        update: {
          status: "FAILED",
          errorCode: code,
          analysis: null,
          completedAt: null,
        },
      });
    } catch { /* keep the original error */ }
    if (err instanceof AiValidationError || err instanceof AiProviderError) throw err;
    throw new AiProviderError("PROVIDER_ERROR", "The AI provider request failed.");
  }
}
