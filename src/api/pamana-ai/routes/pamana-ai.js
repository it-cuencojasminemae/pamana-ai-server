'use strict';

/**
 * pamana-ai router
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/pamana-ai/trip-plan',
      handler: 'trip-plan.create',
      // Strapi authentication remains enabled by default. Access is granted
      // only to selected authenticated roles during bootstrap.
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
