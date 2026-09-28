'use strict';

const assert = require('node:assert/strict');
const { normalizeNode } = require('../src/services/pamana-journey/graph-builder');
const { transitGeometryMap } = require('../src/services/pamana-journey/trip-plan-orchestrator');

const node = normalizeNode({
  documentId: 'field-node-id', node_code: 'FIELD-NODE', name: 'Field node', node_type: 'STOP',
  latitude: '15.1', longitude: '120.7', verification_status: 'FIELD_VERIFIED', data_mode: 'REAL',
});
assert.equal(node.lat, 15.1);
assert.equal(node.lng, 120.7);

const geometry = { type: 'LineString', coordinates: [[120.7, 15.1], [120.69, 15.05]] };
assert.equal(transitGeometryMap({ variants: [{ documentId: 'approx', geometry_source: 'APPROXIMATE_ROAD_PATH', geometry_geojson: geometry }] }).size, 0);
assert.deepEqual(transitGeometryMap({ variants: [{ documentId: 'verified', geometry_source: 'FIELD_GPS', geometry_geojson: geometry }] }).get('verified'), geometry);

console.log('ok - journey contracts expose stored eligible node coordinates without creating geometry');
console.log('ok - planner rejects APPROXIMATE_ROAD_PATH and consumes only verified transit geometry sources');
