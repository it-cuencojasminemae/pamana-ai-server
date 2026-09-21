'use strict';

/**
 * OpenAI implementation of AIExplainProvider (see ./types.js).
 *
 * Infrastructure only - Phase 17 is not implemented yet, so nothing calls
 * this outside scripts/test-ai-provider.js. Not wired into any controller.
 */

const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 10000;
const FALLBACK_MESSAGE = 'Explanation unavailable right now. Please check the numbers shown above directly.';

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`OpenAI request timed out after ${ms}ms`)), ms)),
  ]);
}

/** @returns {import('./types')} */
function createOpenAIProvider() {
  return {
    async explain(prompt) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return FALLBACK_MESSAGE;

      try {
        // Defensive interop: different openai SDK versions/bundlers expose
        // the client as either the module itself or a `.default`.
        const OpenAIModule = require('openai');
        const OpenAI = OpenAIModule.default || OpenAIModule;

        const client = new OpenAI({ apiKey });
        const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

        const response = await withTimeout(
          client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
          }),
          REQUEST_TIMEOUT_MS
        );

        const text = response?.choices?.[0]?.message?.content?.trim();
        return text || FALLBACK_MESSAGE;
      } catch (error) {
        console.error(`[pamana-ai] OpenAI provider failed: ${error.message}`);
        return FALLBACK_MESSAGE;
      }
    },
  };
}

module.exports = { createOpenAIProvider, FALLBACK_MESSAGE };
