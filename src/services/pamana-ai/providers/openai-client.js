'use strict';

/** OpenAI implementation of the optional passenger explanation provider. */

const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 10000;
const FALLBACK_MESSAGE = 'Explanation unavailable right now. Please check the numbers shown above directly.';
const {
  JOURNEY_OUTPUT_SCHEMA, journeyInput, parseJourneyExplanation, providerFailureReason,
} = require('./journey-contract');

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`OpenAI request timed out after ${ms}ms`)), ms)),
  ]);
}

/** @returns {import('./types')} */
function createOpenAIProvider(options = {}) {
  const configuredKey = () => options.apiKey ?? process.env.OPENAI_API_KEY;
  const configuredModel = () => options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const clientFor = (apiKey) => {
    if (options.client) return options.client;
    // Defensive interop: SDK builds expose the client directly or as default.
    const OpenAIModule = require('openai');
    const OpenAI = OpenAIModule.default || OpenAIModule;
    return new OpenAI({ apiKey });
  };

  return {
    name: 'openai',

    async explain(prompt) {
      const apiKey = configuredKey();
      if (!apiKey) return FALLBACK_MESSAGE;

      try {
        const client = clientFor(apiKey);

        const response = await withTimeout(
          client.chat.completions.create({
            model: configuredModel(),
            messages: [{ role: 'user', content: prompt }],
          }),
          timeoutMs
        );

        const text = response?.choices?.[0]?.message?.content?.trim();
        return text || FALLBACK_MESSAGE;
      } catch {
        console.error('[pamana-ai] OpenAI provider unavailable');
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
        const response = await clientFor(apiKey).responses.create({
          model: configuredModel(),
          store: false,
          instructions: systemPrompt,
          input: [{
            role: 'user',
            content: [{
              type: 'input_text',
              text: journeyInput(facts),
            }],
          }],
          text: {
            format: {
              type: 'json_schema',
              name: 'pamana_journey_explanation',
              strict: true,
              schema: JOURNEY_OUTPUT_SCHEMA,
            },
          },
          max_output_tokens: 700,
        }, { signal: abort.signal });
        return parseJourneyExplanation(response?.output_text);
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

module.exports = { createOpenAIProvider, FALLBACK_MESSAGE, JOURNEY_OUTPUT_SCHEMA };
