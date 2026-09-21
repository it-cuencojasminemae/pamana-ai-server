'use strict';

/**
 * Phase 17 AI-provider selection point. Not called from anywhere yet - see
 * scripts/test-ai-provider.js for the only current caller.
 */

const { createOpenAIProvider } = require('./openai-client');
const { createGeminiProvider } = require('./gemini-client');

const DEFAULT_PROVIDER = 'gemini';

/** @returns {import('./types')} */
function getAIExplainProvider() {
  const provider = (process.env.AI_PROVIDER || DEFAULT_PROVIDER).toLowerCase();

  if (provider === 'openai') return createOpenAIProvider();
  if (provider === 'gemini') return createGeminiProvider();

  throw new Error(`Unknown AI_PROVIDER "${provider}". Expected "openai" or "gemini".`);
}

module.exports = { getAIExplainProvider };
