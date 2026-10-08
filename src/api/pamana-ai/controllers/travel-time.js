'use strict';

const { validateTripPlanRequest } = require('../../../services/pamana-journey/trip-plan-request-validator');
const { orchestrateTripPlan } = require('../../../services/pamana-journey/trip-plan-orchestrator');
const { estimateJourneyTime } = require('../../../services/pamana-journey/travel-time');
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { consumeRateLimit, bodyBytes, plainObject } = require('../../../services/security/request-guard');
const { passengerPlanningContext } = require('../../../services/pamana-journey/passenger-planning-context');
const { requestBudget } = require('../../../services/pamana-journey/provider-budget');

function createTravelTimeHandler({ validate = validateTripPlanRequest, orchestrate = orchestrateTripPlan,
  estimate = estimateJourneyTime, enabled = () => process.env.PAMANA_TRAVEL_TIME_ENABLED === 'true' } = {}) {
  return async ctx => {
    if (!enforceRole(ctx, [ROLE.PASSENGER, ROLE.LGU, ROLE.ADMINISTRATOR])) return;
    if (!consumeRateLimit(ctx, 'travel-time', { limit: 30, windowMs: 60000 })) return;
    ctx.set?.('Cache-Control', 'no-store');
    const body = ctx.request?.body;
    if (!plainObject(body) || bodyBytes(body) > 10000 || Object.keys(body).some(key => !['request', 'journeyId'].includes(key))
      || typeof body.journeyId !== 'string' || !body.journeyId.trim() || body.journeyId.length > 500) {
      ctx.status = 400; ctx.body = { status: 'INVALID_REQUEST', message: 'A trip request and selected journey are required.' }; return;
    }
    let context;
    try { context = await passengerPlanningContext(body.request?.planningMode || 'OPERATIONAL', ctx.state.user); }
    catch { ctx.status = 403; ctx.body = { status: 'RESEARCH_PREVIEW_DISABLED' }; return; }
    const checked = validate(body.request, { context });
    if (!checked.ok) { ctx.status = 400; ctx.body = checked.error; return; }
    if (!enabled()) { ctx.body = { status: 'DISABLED', journeyId: body.journeyId }; return; }
    const startedAt = Date.now();
    const budget = requestBudget(ctx.request?.signal, 15000);
    try {
      const plan = await orchestrate(checked.value, { strapiInstance: global.strapi, signal: budget.signal, context, config: { details: true } });
      const journey = plan.journeys?.find(value => value.id === body.journeyId);
      if (!journey || !journey.dataQuality?.planningEligible || journey.dataQuality.dataModes?.some(mode => mode !== 'REAL')) {
        ctx.body = { status: 'UNAVAILABLE', journeyId: body.journeyId, reasons: ['JOURNEY_NO_LONGER_ELIGIBLE'] }; return;
      }
      ctx.body = { ...await estimate(journey, { signal: budget.signal }), planningMode: context.mode,
        evidenceClass: context.researchPreview ? 'RESEARCH_PREVIEW' : 'VERIFIED_OPERATIONAL' };
    } catch {
      ctx.body = { status: 'UNAVAILABLE', journeyId: body.journeyId, reasons: ['SERVICE_UNAVAILABLE'] };
    } finally {
      budget.dispose();
      if (process.env.PAMANA_TRAVEL_TIME_LOG_METRICS === 'true') {
        const reasons = (ctx.body?.reasons || []).filter(reason => typeof reason === 'string' && /^[A-Z_]+$/.test(reason)).join(',');
        global.strapi?.log?.info?.(`[pamana-travel-time] status=${ctx.body?.status || 'UNAVAILABLE'} elapsedMs=${Date.now() - startedAt} reasons=${reasons}`);
      }
    }
  };
}

module.exports = { create: createTravelTimeHandler(), createTravelTimeHandler };
