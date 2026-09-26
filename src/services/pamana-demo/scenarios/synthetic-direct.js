'use strict';

// Deliberately offshore synthetic geometry. It is not a Pampanga corridor and
// must never be interpreted as transport research or passenger guidance.
const SYNTHETIC_DIRECT_SCENARIO = Object.freeze({
  scenarioId: 'synthetic-direct-corridor',
  name: 'Synthetic Direct Corridor',
  notice: 'SIMULATED DEMO / NOT REAL TRANSPORT DATA',
  dataMode: 'SIMULATED',
  durationSeconds: 60,
  loop: true,
  routeVariantId: 'SIM-DEMO-DIRECT-ONLY',
  routeGeometry: Object.freeze({
    type: 'LineString',
    coordinates: Object.freeze([
      Object.freeze([140.0000, 5.0000]),
      Object.freeze([140.0180, 5.0120]),
      Object.freeze([140.0430, 4.9980]),
    ]),
  }),
  nodes: Object.freeze([
    Object.freeze({ id: 'synthetic-node-a', label: 'Synthetic Node A', coordinateIndex: 0 }),
    Object.freeze({ id: 'synthetic-node-b', label: 'Synthetic Node B', coordinateIndex: 1 }),
    Object.freeze({ id: 'synthetic-node-c', label: 'Synthetic Node C', coordinateIndex: 2 }),
  ]),
  vehicles: Object.freeze([
    Object.freeze({
      vehicleId: 'sim-vehicle-a', label: 'Demo Vehicle A', transportMode: 'JEEPNEY',
      startOffsetSeconds: 0, observationLagSeconds: 0,
      occupancyProfile: Object.freeze([
        Object.freeze({ fromSecond: 0, toSecond: 20, status: 'AVAILABLE' }),
        Object.freeze({ fromSecond: 20, toSecond: 40, status: 'NEAR_FULL' }),
        Object.freeze({ fromSecond: 40, toSecond: 60, status: 'FULL' }),
      ]),
    }),
    Object.freeze({
      vehicleId: 'sim-vehicle-b', label: 'Demo Vehicle B', transportMode: 'JEEPNEY',
      startOffsetSeconds: 20, observationLagSeconds: 0,
      occupancyProfile: Object.freeze([Object.freeze({ fromSecond: 0, toSecond: 60, status: 'NEAR_FULL' })]),
    }),
    Object.freeze({
      vehicleId: 'sim-vehicle-c', label: 'Demo Vehicle C', transportMode: 'JEEPNEY',
      startOffsetSeconds: 40, observationLagSeconds: 0,
      occupancyProfile: Object.freeze([Object.freeze({ fromSecond: 0, toSecond: 60, status: 'FULL' })]),
    }),
  ]),
});

module.exports = { SYNTHETIC_DIRECT_SCENARIO };
