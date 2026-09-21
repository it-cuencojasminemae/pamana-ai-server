'use strict';

/**
 * Phase 17 AI-provider contract (documentation only - this project has no
 * TypeScript tooling, so this is a JSDoc typedef rather than a real
 * interface; see openai-client.js and gemini-client.js for the two
 * implementations, and index.js for the provider switch).
 *
 * Hard rule (PAMANA_CLAUDE_CODE_CONTEXT.md §8): a provider's `explain` only
 * puts already-computed numbers into plain language - it must never invent
 * transportation facts, statistics, or route details, and it must never
 * throw. Any failure or timeout resolves to a fixed fallback string instead.
 *
 * @typedef {Object} AIExplainProvider
 * @property {(prompt: string) => Promise<string>} explain
 */

module.exports = {};
