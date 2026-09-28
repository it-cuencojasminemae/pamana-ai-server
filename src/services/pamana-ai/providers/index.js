'use strict';

/**
 * Server-owned provider selection for legacy explanations and the factual
 * Phase 20 journey explanation. Passenger requests never choose a provider.
 */

const { createOpenAIProvider } = require('./openai-client');
const { createGeminiProvider } = require('./gemini-client');

const DEFAULT_PROVIDER = 'gemini';

/** @returns {import('./types')} */
function unavailableProvider() {
  return {
    name: null,
    async explain() { return 'Explanation unavailable right now. Please check the numbers shown above directly.'; },
    async explainJourney() { return { ok: false, reason: 'INVALID_PROVIDER' }; },
  };
}

function getAIExplainProvider({
  providerName = process.env.AI_PROVIDER || DEFAULT_PROVIDER,
  factories = { openai: createOpenAIProvider, gemini: createGeminiProvider },
} = {}) {
  const provider = typeof providerName === 'string' ? providerName.trim().toLowerCase() : '';

  if (provider === 'openai') return factories.openai();
  if (provider === 'gemini') return factories.gemini();

  return unavailableProvider();
}

module.exports = { getAIExplainProvider, DEFAULT_PROVIDER };
