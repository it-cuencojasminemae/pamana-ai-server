'use strict';

/**
 * pamana-ai router
 */

module.exports = {
  routes: [
    // These read-only map resources use the existing map-access permission.
    // Authentication and role checks stay enabled; no permission DB changes.
    { method: 'GET', path: '/pamana-ai/traffic', handler: 'traffic.find', config: { auth: { scope: ['api::pamana-ai.pin-area.find'] }, policies: [] } },
    { method: 'GET', path: '/pamana-ai/traffic-tiles/:z/:x/:y', handler: 'traffic.tile', config: { auth: { scope: ['api::pamana-ai.pin-area.find'] }, policies: [] } },
    { method: 'GET', path: '/pamana-ai/planning-capabilities', handler: 'planning-capabilities.find', config: { policies: [] } },
    { method: 'POST', path: '/pamana-ai/journey-details', handler: 'journey-details.create', config: { policies: [] } },
    { method: 'GET', path: '/pamana-ai/landmarks', handler: 'landmarks.find', config: { policies: [] } },
    { method: 'GET', path: '/pamana-ai/pin-area', handler: 'pin-area.find', config: { policies: [] } },
    { method: 'POST', path: '/pamana-ai/travel-time', handler: 'travel-time.create', config: { policies: [] } },
    {
      method: 'POST',
      path: '/pamana-ai/trip-plan',
      handler: 'trip-plan.create',
      // Strapi authentication remains enabled by default. Access is granted
      // only to selected authenticated roles during bootstrap.
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/pamana-ai/journey-explanation',
      handler: 'journey-explanation.create',
      // Authenticated and granted explicitly to passenger-facing roles.
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/pamana-ai/wait-time',
      handler: 'pamana-ai.waitTime',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/pamana-ai/demand',
      handler: 'pamana-ai.demand',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/pamana-ai/supply-demand',
      handler: 'pamana-ai.supplyDemand',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/pamana-ai/dashboard-summary',
      handler: 'pamana-ai.dashboardSummary',
      config: { policies: [] },
    },
  ],
};
