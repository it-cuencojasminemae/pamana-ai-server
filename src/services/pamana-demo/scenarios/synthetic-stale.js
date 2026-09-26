'use strict';

const { SYNTHETIC_DIRECT_SCENARIO } = require('./synthetic-direct');

const SYNTHETIC_STALE_SCENARIO = Object.freeze({
  ...SYNTHETIC_DIRECT_SCENARIO,
  scenarioId: 'synthetic-stale-diagnostic',
  name: 'Synthetic Stale Vehicle Diagnostic',
  vehicles: Object.freeze([
    Object.freeze({
      ...SYNTHETIC_DIRECT_SCENARIO.vehicles[0],
      vehicleId: 'sim-stale-vehicle',
      label: 'Demo Stale Vehicle',
      observationLagSeconds: 90,
      occupancyProfile: Object.freeze([Object.freeze({ fromSecond: 0, toSecond: 60, status: 'UNKNOWN' })]),
    }),
  ]),
});

module.exports = { SYNTHETIC_STALE_SCENARIO };
