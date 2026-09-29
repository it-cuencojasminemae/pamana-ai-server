'use strict';

const { validateTripPlanRequest } = require('../../../services/pamana-journey/trip-plan-request-validator');
const { orchestrateTripPlan } = require('../../../services/pamana-journey/trip-plan-orchestrator');
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { consumeRateLimit } = require('../../../services/security/request-guard');

function createTripPlanHandler({
  validate = validateTripPlanRequest,
  orchestrate = orchestrateTripPlan,
  now = () => new Date(),
} = {}) {
  return async function tripPlan(ctx) {
    if (!enforceRole(ctx, [ROLE.PASSENGER, ROLE.LGU, ROLE.ADMINISTRATOR])) return;
    if (!consumeRateLimit(ctx, 'trip-plan', { limit: 30, windowMs: 60_000 })) return;
    const validation = validate(ctx.request?.body, { now });
    if (!validation.ok) {
      ctx.status = 400;
      ctx.body = validation.error;
      return;
    }
    try {
      const result = await orchestrate(validation.value, {
        strapiInstance: global.strapi,
        now,
        signal: ctx.request?.signal,
      });
      ctx.status = result.status === 'ROUTING_PROVIDER_UNAVAILABLE' ? 503 : 200;
      ctx.body = result;
    } catch {
      ctx.status = 503;
      ctx.body = Object.freeze({
        status: 'SERVICE_UNAVAILABLE',
        message: 'Trip planning is temporarily unavailable.',
      });
    }
  };
}

module.exports = {
  create: createTripPlanHandler(),
  createTripPlanHandler,
};
