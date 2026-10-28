import test from "node:test";
import assert from "node:assert/strict";
import { MockProvider, OpenAiProvider, AiProviderError } from "../lib/ai/providers.js";
import { validAnalysis } from "./ai-fixture.js";

const input = { diagnosticOutcome: "HTTP_ERROR_RESPONSE", httpStatus: 500, findings: [] };

test("mock provider success returns the canned analysis", async () => {
  const mock = new MockProvider({ analysis: validAnalysis("f1") });
  const result = await mock.analyze(input);
  assert.equal(result.provider, "mock");
  assert.equal(result.analysis.schemaVersion, "1");
  assert.equal(mock.calls, 1);
});

for (const [behavior, code] of [
  ["timeout", "PROVIDER_TIMEOUT"],
  ["rate_limited", "PROVIDER_RATE_LIMITED"],
  ["outage", "PROVIDER_ERROR"],
  ["refusal", "PROVIDER_REFUSAL"],
  ["malformed", "INVALID_OUTPUT"],
  ["oversized", "INVALID_OUTPUT"],
  ["network_failure", "PROVIDER_ERROR"],
]) {
  test(`mock provider ${behavior} maps to ${code}`, async () => {
    const mock = new MockProvider({ behavior, analysis: validAnalysis("f1") });
    await assert.rejects(() => mock.analyze(input), (e) => e instanceof AiProviderError && e.code === code);
  });
}

test("openai adapter uses strict json_schema, handles refusal, 429, errors without leaking bodies", async () => {
  const seen = [];
  const stub = async (url, opts) => {
    seen.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(validAnalysis("f1")) } }] }),
    };
  };
  const provider = new OpenAiProvider({ apiKey: "test-key-not-real", model: "env-model", fetchFn: stub });
  const result = await provider.analyze(input);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "env-model");
  assert.equal(seen[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(seen[0].body.response_format.type, "json_schema");
  assert.equal(seen[0].body.response_format.json_schema.strict, true);
  assert.equal(seen[0].auth, "Bearer test-key-not-real");

  const refusal = new OpenAiProvider({
    apiKey: "k", model: "m",
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { refusal: "I cannot comply." } }] }) }),
  });
  await assert.rejects(() => refusal.analyze(input), (e) => e.code === "PROVIDER_REFUSAL");

  const limited = new OpenAiProvider({
    apiKey: "k", model: "m",
    fetchFn: async () => ({ ok: false, status: 429, json: async () => ({}) }),
  });
  await assert.rejects(() => limited.analyze(input), (e) => e.code === "PROVIDER_RATE_LIMITED");

  const failing = new OpenAiProvider({
    apiKey: "k", model: "m",
    fetchFn: async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "secret-body-marker" } }) }),
  });
  await assert.rejects(() => failing.analyze(input), (e) => e.code === "PROVIDER_ERROR" && !e.message.includes("secret-body-marker"));

  const badJson = new OpenAiProvider({
    apiKey: "k", model: "m",
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not json" } }] }) }),
  });
  await assert.rejects(() => badJson.analyze(input), (e) => e.code === "INVALID_OUTPUT");
});

test("openai adapter maps aborts to timeout", async () => {
  const err = new Error("aborted");
  err.name = "AbortError";
  const provider = new OpenAiProvider({
    apiKey: "k", model: "m", timeoutMs: 50,
    fetchFn: async () => { throw err; },
  });
  await assert.rejects(() => provider.analyze(input), (e) => e.code === "PROVIDER_TIMEOUT");
});

test("openai adapter requires key and model", () => {
  assert.throws(() => new OpenAiProvider({ apiKey: "", model: "m" }), (e) => e.code === "AI_NOT_CONFIGURED");
  assert.throws(() => new OpenAiProvider({ apiKey: "k", model: "" }), (e) => e.code === "AI_NOT_CONFIGURED");
});
