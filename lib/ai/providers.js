// Provider-independent AI adapter (Milestone 4). The application only ever
// talks to `analyze(messages)`; vendor details stay here. Server-side only:
// the API key never reaches the browser, logs, or error messages.
//
// OpenAI adapter (checked against OpenAI's structured-output documentation,
// Oct 2026): Chat Completions with response_format { type: "json_schema",
// json_schema: { name, strict: true, schema } }. Strict mode requires every
// field in `required` and additionalProperties: false on every object, so
// the schema below is written in that subset. Local validation (schema.js /
// validate.js) still runs on every response — provider schema conformance
// does not replace it. Refusals (message.refusal) are a distinct outcome,
// not a malformed result.

import { buildAiMessages } from "./prompt.js";

export class AiProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AiProviderError";
    this.code = code; // AI_NOT_CONFIGURED | PROVIDER_TIMEOUT | PROVIDER_RATE_LIMITED | PROVIDER_ERROR | PROVIDER_REFUSAL | INVALID_OUTPUT
  }
}

export const AI_MAX_RESPONSE_BYTES = 64 * 1024;

const CONFIDENCE_ENUM = ["LOW", "MEDIUM", "HIGH"];
const PRIORITY_ENUM = ["LOW", "MEDIUM", "HIGH"];

// Strict-mode subset schema for the OpenAI request. Every property is
// required and additionalProperties is false throughout.
export const OPENAI_JSON_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { type: "string" },
    summary: { type: "string" },
    explanation: { type: "string" },
    diagnosticConfidence: { type: "string", enum: CONFIDENCE_ENUM },
    confirmedObservations: {
      type: "array",
      items: {
        type: "object",
        properties: { findingId: { type: "string" }, observation: { type: "string" } },
        required: ["findingId", "observation"],
        additionalProperties: false,
      },
    },
    causeHypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          explanation: { type: "string" },
          confidence: { type: "string", enum: CONFIDENCE_ENUM },
          supportingFindingIds: { type: "array", items: { type: "string" } },
          additionalEvidenceRequired: { type: "string" },
        },
        required: ["title", "explanation", "confidence", "supportingFindingIds", "additionalEvidenceRequired"],
        additionalProperties: false,
      },
    },
    recommendedActions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          explanation: { type: "string" },
          priority: { type: "string", enum: PRIORITY_ENUM },
          riskLevel: { type: "string", enum: PRIORITY_ENUM },
          skillLevel: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          referencedFindingIds: { type: "array", items: { type: "string" } },
          humanReviewRecommended: { type: "boolean" },
        },
        required: ["title", "explanation", "priority", "riskLevel", "skillLevel", "steps", "referencedFindingIds", "humanReviewRecommended"],
        additionalProperties: false,
      },
    },
    missingEvidence: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
    humanReviewRecommended: { type: "boolean" },
  },
  required: ["schemaVersion", "summary", "explanation", "diagnosticConfidence", "confirmedObservations", "causeHypotheses", "recommendedActions", "missingEvidence", "limitations", "humanReviewRecommended"],
  additionalProperties: false,
};

function parseProviderJson(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new AiProviderError("INVALID_OUTPUT", "The AI provider returned an empty response.");
  }
  if (text.length > AI_MAX_RESPONSE_BYTES) {
    throw new AiProviderError("INVALID_OUTPUT", "The AI provider response exceeded the permitted size.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError("INVALID_OUTPUT", "The AI provider response was not valid JSON.");
  }
}

// Mock provider for tests only. Never used by production routes unless a
// caller explicitly injects it (tests do; the route does not).
export class MockProvider {
  // behavior: "success" | "timeout" | "rate_limited" | "outage" | "refusal" | "malformed" | "oversized" | "network_failure"
  // analysis: canned analysis object returned on success. capture: optional
  // array that receives { messages } for injection assertions.
  // messagesBuilder: Milestone 6 narrow extension — Tool 02 passes its own
  // conflict prompt builder; default keeps the Milestone 4 scan prompt.
  constructor({ behavior = "success", analysis = null, capture = null, messagesBuilder = null } = {}) {
    this.providerName = "mock";
    this.model = "mock-1";
    this.behavior = behavior;
    this.analysis = analysis;
    this.capture = capture;
    this.calls = 0;
    this.messagesBuilder = messagesBuilder || buildAiMessages;
  }
  async analyze(diagnosticInput) {
    this.calls += 1;
    const messages = this.messagesBuilder(diagnosticInput);
    if (this.capture) this.capture.push({ messages });
    switch (this.behavior) {
      case "success":
        if (!this.analysis) throw new AiProviderError("INVALID_OUTPUT", "Mock provider has no canned analysis.");
        return { provider: "mock", model: "mock-1", analysis: this.analysis };
      case "timeout": throw new AiProviderError("PROVIDER_TIMEOUT", "The AI provider request timed out.");
      case "rate_limited": throw new AiProviderError("PROVIDER_RATE_LIMITED", "The AI provider rate limit was reached.");
      case "outage": throw new AiProviderError("PROVIDER_ERROR", "The AI provider is unavailable.");
      case "refusal": throw new AiProviderError("PROVIDER_REFUSAL", "The AI provider refused to answer.");
      case "malformed": throw new AiProviderError("INVALID_OUTPUT", "The AI provider response was not valid JSON.");
      case "oversized": throw new AiProviderError("INVALID_OUTPUT", "The AI provider response exceeded the permitted size.");
      case "network_failure": throw new AiProviderError("PROVIDER_ERROR", "The AI provider request failed.");
      default: throw new AiProviderError("PROVIDER_ERROR", "Unknown mock provider behavior.");
    }
  }
}

export class OpenAiProvider {
  // fetchFn injectable for tests; defaults to global fetch. apiKey is held
  // only here and used solely in the Authorization header.
  constructor({ apiKey, model, timeoutMs = 30000, maxOutputTokens = 2000, fetchFn = null, messagesBuilder = null } = {}) {
    if (!apiKey) throw new AiProviderError("AI_NOT_CONFIGURED", "AI is not configured.");
    if (!model) throw new AiProviderError("AI_NOT_CONFIGURED", "AI is not configured.");
    this.providerName = "openai";
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxOutputTokens = maxOutputTokens;
    this.fetchFn = fetchFn || globalThis.fetch;
    this.messagesBuilder = messagesBuilder || buildAiMessages;
  }

  async analyze(diagnosticInput) {
    const messages = this.messagesBuilder(diagnosticInput);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetchFn("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: { name: "wp_doctor_ai_analysis", strict: true, schema: OPENAI_JSON_SCHEMA },
          },
          max_tokens: this.maxOutputTokens,
          temperature: 0,
        }),
      });
    } catch (err) {
      if (err?.name === "AbortError") throw new AiProviderError("PROVIDER_TIMEOUT", "The AI provider request timed out.");
      throw new AiProviderError("PROVIDER_ERROR", "The AI provider request failed.");
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) throw new AiProviderError("PROVIDER_RATE_LIMITED", "The AI provider rate limit was reached.");
    if (!res.ok) throw new AiProviderError("PROVIDER_ERROR", "The AI provider returned an error.");
    let data;
    try {
      data = await res.json();
    } catch {
      throw new AiProviderError("INVALID_OUTPUT", "The AI provider response was not valid JSON.");
    }
    const message = data?.choices?.[0]?.message;
    if (!message) throw new AiProviderError("INVALID_OUTPUT", "The AI provider response had an unexpected structure.");
    if (message.refusal) throw new AiProviderError("PROVIDER_REFUSAL", "The AI provider refused to answer.");
    const analysis = parseProviderJson(message.content);
    return { provider: "openai", model: this.model, analysis };
  }
}
