'use strict';

const {
  node,
  route,
  stop,
  variant,
} = require('./phase10-synthetic-network');

const withCoordinates = (record, latitude, longitude) => ({
  ...record,
  latitude,
  longitude,
});

function directWalkingFixture() {
  const nodes = {
    A: withCoordinates(node('WALK-A'), 14.6000, 120.9800),
    B: withCoordinates(node('WALK-B'), 14.6100, 120.9900),
  };
  const routeRecord = route('WALK-DIRECT', 'PUJ_TRADITIONAL');
  return {
    origin: { lat: 14.5994, lng: 120.9794, label: 'Synthetic origin' },
    destination: { lat: 14.6106, lng: 120.9906, label: 'Synthetic destination' },
    nodes,
    variants: [variant('WALK-DIRECT-OUT', 'OUTBOUND', routeRecord, [
      stop('WALK-DIRECT-OUT', nodes.A, 1, { dropoff_allowed: false }),
      stop('WALK-DIRECT-OUT', nodes.B, 2, { pickup_allowed: false }),
    ])],
  };
}

function transferWalkingFixture() {
  const nodes = {
    A: withCoordinates(node('WALK-TA'), 14.6000, 120.9800),
    T: withCoordinates(node('WALK-T'), 14.6050, 120.9850),
    B: withCoordinates(node('WALK-TB'), 14.6100, 120.9900),
  };
  const local = route('WALK-LOCAL', 'TRICYCLE');
  const trunk = route('WALK-TRUNK', 'PUJ_MODERN');
  return {
    origin: { lat: 14.5994, lng: 120.9794, label: 'Synthetic origin' },
    destination: { lat: 14.6106, lng: 120.9906, label: 'Synthetic destination' },
    nodes,
    variants: [
      variant('WALK-LOCAL-OUT', 'OUTBOUND', local, [
        stop('WALK-LOCAL-OUT', nodes.A, 1, { dropoff_allowed: false }),
        stop('WALK-LOCAL-OUT', nodes.T, 2, { pickup_allowed: false, transfer_allowed: true }),
      ]),
      variant('WALK-TRUNK-OUT', 'OUTBOUND', trunk, [
        stop('WALK-TRUNK-OUT', nodes.T, 1, { dropoff_allowed: false, transfer_allowed: true }),
        stop('WALK-TRUNK-OUT', nodes.B, 2, { pickup_allowed: false }),
      ]),
    ],
  };
}

module.exports = {
  directWalkingFixture,
  transferWalkingFixture,
  withCoordinates,
};
