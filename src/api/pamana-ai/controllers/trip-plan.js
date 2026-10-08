'use strict';

const { validateTripPlanRequest } = require('../../../services/pamana-journey/trip-plan-request-validator');
const { orchestrateTripPlan } = require('../../../services/pamana-journey/trip-plan-orchestrator');
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { consumeRateLimit } = require('../../../services/security/request-guard');
const { passengerPlanningContext } = require('../../../services/pamana-journey/passenger-planning-context');

function createTripPlanHandler({
  validate = validateTripPlanRequest,
  orchestrate = orchestrateTripPlan,
  now = () => new Date(),
} = {}) {
  return async function tripPlan(ctx) {
    if (!enforceRole(ctx, [ROLE.PASSENGER, ROLE.LGU, ROLE.ADMINISTRATOR])) return;
    if (!consumeRateLimit(ctx, 'trip-plan', { limit: 30, windowMs: 60_000 })) return;
    let context;
    try { context = await passengerPlanningContext(ctx.request?.body?.planningMode || 'OPERATIONAL', ctx.state.user); }
    catch (error) { ctx.status = error.message === 'RESEARCH_PREVIEW_DISABLED' ? 403 : 400;
      ctx.body = { status: error.message, message: 'Research preview requires both server preview flags and an explicit mode selection.' }; return; }
    ctx.set?.('Cache-Control', 'no-store');
    const validation = validate(ctx.request?.body, { now, context });
    if (!validation.ok) {
      ctx.status = 400;
      ctx.body = validation.error;
      return;
    }
    const startedAt = Date.now();
    try {
      const result = await orchestrate(validation.value, {
        strapiInstance: global.strapi,
        now,
        signal: ctx.request?.signal,
        context,
      });
      ctx.status = result.status === 'ROUTING_PROVIDER_UNAVAILABLE' ? 503 : 200;
      ctx.body = result;
    } catch {
      ctx.status = 503;
      ctx.body = Object.freeze({
        status: 'SERVICE_UNAVAILABLE',
        message: 'Trip planning is temporarily unavailable.',
      });
    } finally {
      if (process.env.PAMANA_CSF_LOG_METRICS === 'true') {
        const walkFailures = (ctx.body?.warnings || []).filter(code => typeof code === 'string' && /^(ROUTING_|TRANSFER_WALK_|WALKING_ROUTE_)/.test(code)).filter(code => /^[A-Z_]+$/.test(code));
        global.strapi?.log?.info?.(`[pamana-trip-plan] status=${ctx.body?.status || 'SERVICE_UNAVAILABLE'} elapsedMs=${Date.now() - startedAt} journeyCount=${ctx.body?.journeys?.length || 0} walkingFailures=${walkFailures.join(',')}`);
      }
    }
  };
}

module.exports = {
  create: createTripPlanHandler(),
  createTripPlanHandler,
};
