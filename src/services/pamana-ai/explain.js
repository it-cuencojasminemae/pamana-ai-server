'use strict';

/**
 * Phase 17 - turns an already-computed wait-time prediction into one
 * plain-language sentence for the passenger, via whichever provider
 * AI_PROVIDER selects (./providers). Hard rule
 * (documentation/PAMANA_CLAUDE_CODE_CONTEXT.md §8): the prompt below states
 * every number the model is allowed to use - it is only asked to phrase
 * them, never to add a route name, a fare, a cause, or any other fact that
 * isn't given here.
 *
 * Never throws: any provider failure resolves to a fixed fallback string,
 * same contract as the providers themselves (see ./providers/types.js).
 */

const { getAIExplainProvider } = require('./providers');

const FALLBACK_EXPLANATION = 'Explanation unavailable right now. Please check the numbers shown above directly.';

function buildWaitTimePrompt(waitTime) {
  const { predicted_wait_minutes, availability_class, confidence, active_vehicles } = waitTime;

  return [
    'A passenger is asking how long until the next jeepney on this route.',
    `Predicted wait: ${predicted_wait_minutes.low}-${predicted_wait_minutes.high} minutes.`,
    `Availability: ${availability_class}.`,
    `Confidence: ${Math.round(confidence * 100)}%.`,
    `Vehicles currently active on this route: ${active_vehicles}.`,
    'Explain this to the passenger in one short, plain-language sentence.',
    'Do not invent any numbers, routes, causes, or facts beyond what is given above.',
  ].join(' ');
}

/**
 * @param {ReturnType<typeof import('./wait-time').predictWaitTime>} waitTime
 * @returns {Promise<string>}
 */
async function explainWaitTime(waitTime) {
  try {
    const provider = getAIExplainProvider();
    const explanation = await provider.explain(buildWaitTimePrompt(waitTime));
    return explanation || FALLBACK_EXPLANATION;
  } catch (error) {
    console.error(`[pamana-ai] explainWaitTime failed: ${error.message}`);
    return FALLBACK_EXPLANATION;
  }
}

/**
 * The route-selection algorithm is responsible for choosing an option. The
 * model receives the selected option only after that calculation has already
 * finished, and is allowed to explain the displayed fields in plain language.
 * This keeps an LLM from fabricating a route, vehicle, fare, or ETA.
 */
function buildTripRecommendationPrompt(option) {
  const wait = option.predicted_wait_minutes
    ? `${option.predicted_wait_minutes.low}-${option.predicted_wait_minutes.high} minutes`
    : 'not available';
  const fare = typeof option.fare === 'number' ? `PHP ${option.fare.toFixed(2)}` : 'not available';
  const travelTime = typeof option.estimated_travel_minutes === 'number'
    ? `${option.estimated_travel_minutes} minutes`
    : 'not available';
  const totalTime = typeof option.total_journey_minutes === 'number'
    ? `${option.total_journey_minutes} minutes`
    : 'not available';
  const fareDescription = option.fare_source === 'simulation' ? 'demo fare estimate' : 'reference fare estimate';
  const waitDescription = option.wait_source === 'observed' ? 'predicted wait' : 'fallback wait estimate';

  return [
    'PAMANA has already selected the recommended transport option using its route-scoring algorithm.',
    'Explain the recommendation to a passenger in one or two short, practical sentences.',
    `Service: ${option.service_name}.`,
    `Travel from: ${option.origin}.`,
    `Travel to: ${option.destination}.`,
    `Board at: ${option.pickup_stop?.name || 'not available'}.`,
    `Get off at: ${option.dropoff_stop?.name || 'not available'}.`,
    `${fareDescription}: ${fare}.`,
    `Listed travel time: ${travelTime}.`,
    `${waitDescription}: ${wait}.`,
    `Estimated total journey: ${totalTime}.`,
    `Transfers: ${option.transfer_count}.`,
    'Only restate the facts above. Do not call a fare official/current, a wait live, or a vehicle real-time. Do not invent a route, vehicle number, fare, traffic condition, cause, schedule, or any number not provided.',
  ].join(' ');
}

async function explainTripRecommendation(option) {
  try {
    const provider = getAIExplainProvider();
    const explanation = await provider.explain(buildTripRecommendationPrompt(option));
    return explanation || FALLBACK_EXPLANATION;
  } catch (error) {
    console.error(`[pamana-ai] explainTripRecommendation failed: ${error.message}`);
    return FALLBACK_EXPLANATION;
  }
}

module.exports = {
  explainWaitTime,
  buildWaitTimePrompt,
  explainTripRecommendation,
  buildTripRecommendationPrompt,
  FALLBACK_EXPLANATION,
};
