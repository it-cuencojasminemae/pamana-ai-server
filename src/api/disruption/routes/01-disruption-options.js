'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/disruption-target-options',
      handler: 'disruption.options',
      config: { policies: [] },
    },
  ],
};
