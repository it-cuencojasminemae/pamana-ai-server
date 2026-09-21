'use strict';

/**
 * Gemini implementation of AIExplainProvider (see ./types.js).
 *
 * Infrastructure only - Phase 17 is not implemented yet, so nothing calls
 * this outside scripts/test-ai-provider.js. Not wired into any controller.
 */

// Google's free-tier model list changes periodically - keep this
// configurable via GEMINI_MODEL rather than hardcoding it elsewhere. If
// requests start failing with a model-not-found error, check
// https://ai.google.dev/gemini-api/docs/models for the current free-tier name.
const DEFAULT_MODEL = 'gemini-2.5-flash';
const REQUEST_TIMEOUT_MS = 10000;
const FALLBACK_MESSAGE = 'Explanation unavailable right now. Please check the numbers shown above directly.';

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Gemini request timed out after ${ms}ms`)), ms)),
  ]);
}

/** @returns {import('./types')} */
function createGeminiProvider() {
  return {
    async explain(prompt) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return FALLBACK_MESSAGE;

      try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

        const response = await withTimeout(
          ai.models.generateContent({ model, contents: prompt }),
          REQUEST_TIMEOUT_MS
        );

        // `.text` is a plain string property on the current @google/genai
        // SDK's response, but handled defensively in case that changes.
        const text = typeof response?.text === 'function' ? response.text() : response?.text;
        return (text && String(text).trim()) || FALLBACK_MESSAGE;
      } catch (error) {
        console.error(`[pamana-ai] Gemini provider failed: ${error.message}`);
        return FALLBACK_MESSAGE;
      }
    },
  };
}

module.exports = { createGeminiProvider, FALLBACK_MESSAGE };
