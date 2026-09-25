'use strict';

const evidence = Object.freeze({
  planning_enabled: true,
  verification_status: 'FIELD_VERIFIED',
  data_mode: 'REAL',
  verified_at: '2026-09-24T00:00:00.000Z',
  source_name: 'Synthetic Phase 10 unit fixture',
  source_reference: 'TEST-ONLY-PHASE-10',
});

const node = (code, overrides = {}) => ({
  id: `node-${code}`,
  documentId: `node-${code}`,
  node_code: code,
  name: `Fixture node ${code}`,
  node_type: 'DESIGNATED_STOP',
  ...evidence,
  ...overrides,
});

const route = (code, mode = 'PUJ_TRADITIONAL', overrides = {}) => ({
  id: `route-${code}`,
  documentId: `route-${code}`,
  route_code: code,
  route_name: `Fixture route ${code}`,
  transport_mode: mode,
  route_status: 'active',
  active: true,
  ...evidence,
  ...overrides,
});

const stop = (variantCode, transportNode, sequence, overrides = {}) => ({
  id: `stop-${variantCode}-${sequence}`,
  documentId: `stop-${variantCode}-${sequence}`,
  sequence,
  pickup_allowed: true,
  dropoff_allowed: true,
  transfer_allowed: false,
  transport_node: transportNode,
  ...overrides,
});

const variant = (code, direction, routeRecord, stops, overrides = {}) => ({
  id: `variant-${code}`,
  documentId: `variant-${code}`,
  variant_code: code,
  display_name: `Fixture variant ${code}`,
  direction,
  signboard_text: `Signboard ${code}`,
  operating_status: 'ACTIVE',
  effective_from: '2026-01-01',
  effective_to: null,
  route: routeRecord,
  route_variant_stops: stops,
  ...evidence,
  ...overrides,
});

function directFixture({ includeInbound = false } = {}) {
  const nodes = { A: node('A'), B: node('B'), C: node('C') };
  const routeRecord = route('DIRECT');
  const outbound = variant('DIRECT-OUT', 'OUTBOUND', routeRecord, [
    stop('DIRECT-OUT', nodes.A, 1, { dropoff_allowed: false }),
    stop('DIRECT-OUT', nodes.B, 2, { pickup_allowed: false, dropoff_allowed: false }),
    stop('DIRECT-OUT', nodes.C, 3, { pickup_allowed: false }),
  ]);
  const variants = [outbound];
  if (includeInbound) {
    variants.push(variant('DIRECT-IN', 'INBOUND', routeRecord, [
      stop('DIRECT-IN', nodes.C, 1, { dropoff_allowed: false }),
      stop('DIRECT-IN', nodes.B, 2, { pickup_allowed: false, dropoff_allowed: false }),
      stop('DIRECT-IN', nodes.A, 3, { pickup_allowed: false }),
    ]));
  }
  return { nodes, variants };
}

function transferFixture() {
  const nodes = { A: node('TA'), T: node('T'), D: node('D') };
  const localRoute = route('LOCAL', 'TRICYCLE');
  const trunkRoute = route('TRUNK', 'PUJ_TRADITIONAL');
  return {
    nodes,
    variants: [
      variant('LOCAL-OUT', 'OUTBOUND', localRoute, [
        stop('LOCAL-OUT', nodes.A, 1, { dropoff_allowed: false }),
        stop('LOCAL-OUT', nodes.T, 2, { pickup_allowed: false, transfer_allowed: true }),
      ]),
      variant('TRUNK-OUT', 'OUTBOUND', trunkRoute, [
        stop('TRUNK-OUT', nodes.T, 1, { dropoff_allowed: false, transfer_allowed: true }),
        stop('TRUNK-OUT', nodes.D, 2, { pickup_allowed: false }),
      ]),
    ],
  };
}

function throughRouteFixture() {
  const nodes = Object.fromEntries(['X', 'A', 'B', 'C', 'Y'].map((code) => [code, node(`THROUGH-${code}`)]));
  const routeRecord = route('THROUGH', 'BUS');
  return {
    nodes,
    variants: [variant('THROUGH-OUT', 'OUTBOUND', routeRecord,
      ['X', 'A', 'B', 'C', 'Y'].map((code, index) => stop('THROUGH-OUT', nodes[code], index + 1)))],
  };
}

function simulatedFixture() {
  const simulatedEvidence = {
    verification_status: 'SIMULATED_DEMO',
    data_mode: 'SIMULATED',
  };
  const nodes = {
    A: node('SIM-A', simulatedEvidence),
    B: node('SIM-B', simulatedEvidence),
  };
  const routeRecord = route('SIM', 'UV_EXPRESS', simulatedEvidence);
  return {
    nodes,
    variants: [variant('SIM-OUT', 'OUTBOUND', routeRecord, [
      stop('SIM-OUT', nodes.A, 1), stop('SIM-OUT', nodes.B, 2),
    ], simulatedEvidence)],
  };
}

module.exports = {
  directFixture,
  evidence,
  node,
  route,
  simulatedFixture,
  stop,
  throughRouteFixture,
  transferFixture,
  variant,
};
