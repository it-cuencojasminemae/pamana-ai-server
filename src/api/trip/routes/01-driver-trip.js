'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/driver-active-trip',
      handler: 'trip.active',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/driver-trip-options',
      handler: 'trip.options',
      config: { policies: [] },
    },
  ],
};
