'use strict';

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/driver-trips/:id/availability',
      handler: 'trip.availability',
      config: { policies: [] },
    },
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
