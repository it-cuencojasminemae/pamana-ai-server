'use strict';

const { validateTripPlanRequest } = require('../../../services/pamana-journey/trip-plan-request-validator');
const { orchestrateTripPlan } = require('../../../services/pamana-journey/trip-plan-orchestrator');

function createTripPlanHandler({
  validate = validateTripPlanRequest,
  orchestrate = orchestrateTripPlan,
  now = () => new Date(),
} = {}) {
  return async function tripPlan(ctx) {
    if (!ctx.state?.user) return ctx.unauthorized('Authentication is required.');
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
