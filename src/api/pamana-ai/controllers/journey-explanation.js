'use strict';

const { createJourneyExplanationService } = require('../../../services/pamana-ai/journey-explanation');

function createJourneyExplanationHandler({ explain = createJourneyExplanationService() } = {}) {
  return async function journeyExplanation(ctx) {
    if (!ctx.state?.user) return ctx.unauthorized('Authentication is required.');
    const result = await explain(ctx.request?.body, ctx.request?.signal);
    ctx.status = result.status === 'INVALID_JOURNEY' ? 400 : 200;
    ctx.body = result;
  };
}

module.exports = {
  create: createJourneyExplanationHandler(),
  createJourneyExplanationHandler,
};
