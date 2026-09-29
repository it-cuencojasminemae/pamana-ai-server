'use strict';

const { createJourneyExplanationService } = require('../../../services/pamana-ai/journey-explanation');
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { consumeRateLimit } = require('../../../services/security/request-guard');

function createJourneyExplanationHandler({ explain = createJourneyExplanationService() } = {}) {
  return async function journeyExplanation(ctx) {
    if (!enforceRole(ctx, [ROLE.PASSENGER, ROLE.ADMINISTRATOR])) return;
    if (!consumeRateLimit(ctx, 'journey-explanation', { limit: 8, windowMs: 60_000 })) return;
    const result = await explain(ctx.request?.body, ctx.request?.signal);
    ctx.status = result.status === 'INVALID_JOURNEY' ? 400 : 200;
    ctx.body = result;
  };
}

module.exports = {
  create: createJourneyExplanationHandler(),
  createJourneyExplanationHandler,
};
