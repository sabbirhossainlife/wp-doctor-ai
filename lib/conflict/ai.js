// Tool 02 AI interpretation service (Milestone 6). Mirrors the Milestone 4
// scan AI pipeline: generate -> validate -> persist, with the deterministic
// ConflictDiagnostic + ConflictFinding rows as the untouched source of
// truth. AI output is stored ONLY in ConflictAiAnalysis and never overwrites
// deterministic findings. The provider is injectable ONLY as a function
// parameter (tests); production routes use the configured provider and
// never a mock. Unconfigured production AI returns 503 AI_NOT_CONFIGURED
// (via AiProviderError) and the deterministic report remains fully usable.

import { prisma } from "../prisma.js";
import { buildConflictAiInput } from "./ai-input.js";
import { buildConflictAiMessages } from "./ai-prompt.js";
import { validateConflictAnalysis, ConflictAiValidationError, CONFLICT_AI_SCHEMA_VERSION } from "./ai-validate.js";
import { AiProviderError, OpenAiProvider } from "../ai/providers.js";
import { getAiConfig, isAiConfigured } from "../ai/analyze.js";
import { sharedAiRateLimiter } from "../ai/rate-limit.js";

export function publicConflictAnalysis(row) {
  if (!row) return null;
  return {
    id: row.id,
    diagnosticId: row.diagnosticId,
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

export function buildConflictProvider(config) {
  if (!isAiConfigured(config)) {
    throw new AiProviderError("AI_NOT_CONFIGURED", "AI is not configured.");
  }
  return new OpenAiProvider({
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens,
    messagesBuilder: buildConflictAiMessages,
  });
}

// diagnostic: ConflictDiagnostic row (ownership already verified by caller).
// findings: its ConflictFinding rows. providerOverride: test injection only.
// Throws AiProviderError / ConflictAiValidationError; on provider/validation
// failure a FAILED row is persisted (retryable) and the error is rethrown.
export async function generateConflictAiAnalysis({
  diagnostic,
  findings,
  userId,
  regenerate = false,
  providerOverride = null,
  limiter = sharedAiRateLimiter,
  config = getAiConfig(),
}) {
  const existing = await prisma.conflictAiAnalysis.findUnique({ where: { diagnosticId: diagnostic.id } });
  if (existing && existing.status === "COMPLETED" && !regenerate) {
    return { ...publicConflictAnalysis(existing), fromCache: true };
  }
  if (existing && existing.status === "RUNNING") {
    throw new AiProviderError("ALREADY_RUNNING", "An AI analysis is already running for this diagnostic.");
  }

  const provider = providerOverride || buildConflictProvider(config);
  limiter.check(userId);
  limiter.record(userId);
  const input = buildConflictAiInput(diagnostic, findings);
  try {
    const { provider: providerName, model, analysis } = await provider.analyze(input);
    const validated = validateConflictAnalysis(analysis, findings.map((f) => f.id));
    const saved = await prisma.conflictAiAnalysis.upsert({
      where: { diagnosticId: diagnostic.id },
      create: {
        diagnosticId: diagnostic.id,
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
    return { ...publicConflictAnalysis(saved), fromCache: false };
  } catch (err) {
    const code =
      err instanceof ConflictAiValidationError ? "INVALID_OUTPUT"
      : err instanceof AiProviderError ? err.code
      : "PROVIDER_ERROR";
    try {
      await prisma.conflictAiAnalysis.upsert({
        where: { diagnosticId: diagnostic.id },
        create: {
          diagnosticId: diagnostic.id,
          status: "FAILED",
          provider: provider?.providerName || "unknown",
          model: provider?.model || null,
          schemaVersion: CONFLICT_AI_SCHEMA_VERSION,
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
    if (err instanceof ConflictAiValidationError || err instanceof AiProviderError) throw err;
    throw new AiProviderError("PROVIDER_ERROR", "The AI provider request failed.");
  }
}
