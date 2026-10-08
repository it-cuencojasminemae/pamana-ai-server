'use strict';
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { consumeRateLimit, plainObject, bodyBytes } = require('../../../services/security/request-guard');
const { passengerPlanningContext } = require('../../../services/pamana-journey/passenger-planning-context');
const { validateTripPlanRequest } = require('../../../services/pamana-journey/trip-plan-request-validator');
const { orchestrateTripPlan } = require('../../../services/pamana-journey/trip-plan-orchestrator');

module.exports = { async create(ctx) {
  if (!enforceRole(ctx, [ROLE.PASSENGER, ROLE.LGU, ROLE.ADMINISTRATOR])) return;
  if (!consumeRateLimit(ctx, 'journey-details', { limit: 30, windowMs: 60000 })) return;
  ctx.set?.('Cache-Control', 'no-store');
  const body = ctx.request?.body;
  if (!plainObject(body) || bodyBytes(body) > 10000 || Object.keys(body).some(key => !['request', 'journeyId'].includes(key)) || typeof body.journeyId !== 'string' || !body.journeyId || body.journeyId.length > 500) {
    ctx.status = 400; ctx.body = { status: 'INVALID_REQUEST' }; return;
  }
  let context;
  try { context = await passengerPlanningContext(body.request?.planningMode || 'OPERATIONAL', ctx.state.user); }
  catch { ctx.status = 403; ctx.body = { status: 'RESEARCH_PREVIEW_DISABLED' }; return; }
  const checked = validateTripPlanRequest(body.request, { context });
  if (!checked.ok) { ctx.status = 400; ctx.body = checked.error; return; }
  try {
    const plan = await orchestrateTripPlan(checked.value, { context, signal: ctx.request?.signal, config: { details: true } });
    const journey = plan.journeys.find(item => item.id === body.journeyId);
    ctx.body = journey ? { status: 'READY', journey, planningMode: context.mode } : { status: 'UNAVAILABLE', reason: 'JOURNEY_NO_LONGER_ELIGIBLE' };
  } catch { ctx.body = { status: 'UNAVAILABLE', reason: 'SERVICE_UNAVAILABLE' }; }
} };
