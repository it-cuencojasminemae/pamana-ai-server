'use strict';

/**
 * Gemini implementation of AIExplainProvider (see ./types.js).
 *
 * The legacy explain() method remains available. Phase 20 uses the structured
 * explainJourney() method through the server-owned AI_PROVIDER selector.
 */

// Google's free-tier model list changes periodically - keep this
// configurable via GEMINI_MODEL rather than hardcoding it elsewhere. If
// requests start failing with a model-not-found error, check
// https://ai.google.dev/gemini-api/docs/models for the current free-tier name.
const DEFAULT_MODEL = 'gemini-3.6-flash';
const REQUEST_TIMEOUT_MS = 20000;
const JOURNEY_MAX_OUTPUT_TOKENS = 1200;
const TRANSIENT_RETRY_OPTIONS = Object.freeze({
  attempts: 3,
  initialDelay: 0.5,
  maxDelay: 2,
  expBase: 2,
  jitter: 0.2,
  httpStatusCodes: [408, 429, 500, 502, 503, 504],
});
const FALLBACK_MESSAGE = 'Explanation unavailable right now. Please check the numbers shown above directly.';
const {
  JOURNEY_OUTPUT_SCHEMA, journeyInput, parseJourneyExplanation, providerFailureReason,
} = require('./journey-contract');

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Gemini request timed out after ${ms}ms`)), ms)),
  ]);
}

/** @returns {import('./types')} */
function createGeminiProvider(options = {}) {
  const configuredKey = () => options.apiKey ?? process.env.GEMINI_API_KEY;
  const configuredModel = () => options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const clientFor = (apiKey) => {
    if (options.client) return options.client;
    const { GoogleGenAI } = require('@google/genai');
    return new GoogleGenAI({ apiKey });
  };

  return {
    name: 'gemini',

    async explain(prompt) {
      const apiKey = configuredKey();
      if (!apiKey) return FALLBACK_MESSAGE;

      try {
        const response = await withTimeout(
          clientFor(apiKey).models.generateContent({ model: configuredModel(), contents: prompt }),
          timeoutMs
        );

        // `.text` is a plain string property on the current @google/genai
        // SDK's response, but handled defensively in case that changes.
        const text = typeof response?.text === 'function' ? response.text() : response?.text;
        return (text && String(text).trim()) || FALLBACK_MESSAGE;
      } catch {
        console.error('[pamana-ai] Gemini provider unavailable');
        return FALLBACK_MESSAGE;
      }
    },

    async explainJourney(facts, { systemPrompt, signal } = {}) {
      const apiKey = configuredKey();
      if (!apiKey) return { ok: false, reason: 'NOT_CONFIGURED' };
      if (signal?.aborted) return { ok: false, reason: 'ABORTED' };

      const abort = new AbortController();
      let timedOut = false;
      const cancel = () => abort.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
      try {
        const response = await clientFor(apiKey).models.generateContent({
          model: configuredModel(),
          contents: [{ role: 'user', parts: [{ text: journeyInput(facts) }] }],
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            responseJsonSchema: JOURNEY_OUTPUT_SCHEMA,
            maxOutputTokens: JOURNEY_MAX_OUTPUT_TOKENS,
            temperature: 0.2,
            // Journey explanation is constrained formatting, so keep Gemini
            // 3.x reasoning minimal and reserve tokens for the JSON result.
            thinkingConfig: { thinkingLevel: 'minimal' },
            httpOptions: { retryOptions: TRANSIENT_RETRY_OPTIONS },
            abortSignal: abort.signal,
          },
        });
        const text = typeof response?.text === 'function' ? response.text() : response?.text;
        return parseJourneyExplanation(text);
      } catch (error) {
        const reason = providerFailureReason(error, { aborted: signal?.aborted, timedOut });
        // Never log prompts, journey data, credentials, or raw provider bodies.
        console.error(`[pamana-ai] journey explanation unavailable (${reason.toLowerCase()})`);
        return { ok: false, reason };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

module.exports = {
  createGeminiProvider,
  FALLBACK_MESSAGE,
  DEFAULT_MODEL,
  JOURNEY_MAX_OUTPUT_TOKENS,
  TRANSIENT_RETRY_OPTIONS,
};
