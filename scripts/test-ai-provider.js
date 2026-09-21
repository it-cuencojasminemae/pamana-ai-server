'use strict';

/**
 * Standalone smoke test for the AI-provider abstraction. Sends one
 * already-calculated trip recommendation to whichever provider AI_PROVIDER
 * selects and prints the result.
 *
 * Usage: npm run test:ai-provider
 */

const { getAIExplainProvider } = require('../src/services/pamana-ai/providers');
const { buildTripRecommendationPrompt } = require('../src/services/pamana-ai/explain');

const SAMPLE_PROMPT = buildTripRecommendationPrompt({
  service_name: 'San Luis - San Fernando Jeepney',
  origin: 'San Luis, Pampanga',
  destination: 'City of San Fernando, Pampanga',
  pickup_stop: { name: 'San Luis Public Market' },
  dropoff_stop: { name: 'SM City San Fernando' },
  fare: 38,
  estimated_travel_minutes: 45,
  predicted_wait_minutes: { low: 11, high: 20 },
  total_journey_minutes: 65,
  transfer_count: 0,
});

async function main() {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  console.log(`AI_PROVIDER=${provider}`);
  console.log(`Prompt: ${SAMPLE_PROMPT}\n`);

  const aiProvider = getAIExplainProvider();
  const result = await aiProvider.explain(SAMPLE_PROMPT);

  console.log('Result:');
  console.log(result);
}

main().catch((error) => {
  console.error('TEST-AI-PROVIDER FAILED:', error.message);
  process.exit(1);
});
