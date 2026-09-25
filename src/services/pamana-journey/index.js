'use strict';

const { buildTransportGraph } = require('./graph-builder');
const { planJourneys } = require('./journey-planner');
const { loadEligibleTransportGraphData } = require('./transport-data-loader');
const {
  planJourneysWithWalkingCandidates,
  planVerifiedJourneysWithWalking,
} = require('./walking-journey-service');
const {
  enrichJourneyInformation,
  enrichVerifiedJourneyInformation,
} = require('./journey-information-enricher');

async function planVerifiedTransportJourneys({
  candidateBoardingNodeIds,
  candidateDestinationNodeIds,
  demoMode = false,
  serviceDate = new Date(),
  strapiInstance = global.strapi,
} = {}) {
  const data = await loadEligibleTransportGraphData({ strapiInstance, demoMode, serviceDate });
  const graph = buildTransportGraph(data, { demoMode, serviceDate });
  return planJourneys(graph, { candidateBoardingNodeIds, candidateDestinationNodeIds });
}

module.exports = {
  enrichJourneyInformation,
  enrichVerifiedJourneyInformation,
  planJourneysWithWalkingCandidates,
  planVerifiedTransportJourneys,
  planVerifiedJourneysWithWalking,
};
