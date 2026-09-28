'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { manifest, validateManifest } = require('./activate-pilot-field-verified');

validateManifest();

const nodes = Object.fromEntries(manifest.nodes.map((item) => [item.node_code, item]));
assert.deepEqual([nodes['RCH-PSU-MEXICO-FRONT'].latitude, nodes['RCH-PSU-MEXICO-FRONT'].longitude],
  [15.128026422211173, 120.69826461388278]);
assert.deepEqual([nodes['RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER'].latitude, nodes['RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER'].longitude],
  [15.064333794084051, 120.72025022065026]);
assert.deepEqual([nodes['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'].latitude, nodes['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'].longitude],
  [15.05158520927461, 120.69885494898818]);
assert.deepEqual([nodes['RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'].latitude, nodes['RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'].longitude],
  [15.050605637995128, 120.69778203294244]);

const variants = Object.fromEntries(manifest.variants.map((item) => [item.variant_code, item]));
assert.equal(variants['RCH-SJ-SMROB-OUT'].signboard_text, 'SM Pampanga');
assert.equal(variants['RCH-SJ-SMROB-IN'].signboard_text, 'SAN JUAN');
assert.equal(variants['RCH-SJ-SMROB-IN'].start_node_code, 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD');
assert.equal(variants['RCH-SJ-SMROB-IN'].end_node_code, 'RCH-PSU-MEXICO-FRONT');
assert.notDeepEqual(
  [variants['RCH-SJ-SMROB-IN'].start_node_code, variants['RCH-SJ-SMROB-IN'].end_node_code],
  [variants['RCH-SJ-SMROB-OUT'].start_node_code, variants['RCH-SJ-SMROB-OUT'].end_node_code]
);
assert.equal(JSON.stringify(manifest).includes('Magalang jeep → PSU'), false);
assert.match(variants['RCH-SJ-SMROB-IN'].notes, /Magalang service is not a PSU Mexico return service/);

for (const variant of manifest.variants) {
  assert.equal(Object.hasOwn(variant, 'encoded_polyline'), false);
  assert.equal(Object.hasOwn(variant, 'geometry_geojson'), false);
  const stops = manifest.stops.filter((stop) => stop.variant_code === variant.variant_code);
  assert.deepEqual(stops.map((stop) => stop.sequence), [1, 2]);
}
const transferOut = manifest.stops.find((stop) => stop.variant_code === 'PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT' && stop.sequence === 2);
const transferIn = manifest.stops.find((stop) => stop.variant_code === 'PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT' && stop.sequence === 1);
assert.equal(transferOut.node_code, 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER');
assert.equal(transferIn.node_code, transferOut.node_code);
assert.equal(transferOut.transfer_allowed, true);
assert.equal(transferIn.transfer_allowed, true);

const fares = Object.fromEntries(manifest.fare_rules.map((item) => [item.key, item]));
assert.equal(fares['DIRECT-OUTBOUND-REGULAR-30'].regular_base_fare, 30);
assert.match(fares['DIRECT-OUTBOUND-REGULAR-30'].notes, /around PHP 25/);
assert.equal(fares['MEXICO-BAYAN-SM-REGULAR-14'].regular_base_fare, 14);
assert.match(fares['MEXICO-BAYAN-SM-REGULAR-14'].notes, /PHP 11/);
assert.ok(manifest.fare_rules.every((rule) => !Object.hasOwn(rule, 'student_discount_percent')));
assert.deepEqual(manifest.service_patterns, []);
assert.match(manifest.routes.find((route) => route.route_code === 'RCH-SJ-CSF-SM-ROB').notes, /around 4:30 PM/);
assert.match(manifest.routes.find((route) => route.route_code === 'RCH-SJ-CSF-SM-ROB').notes, /no ServicePattern/);

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'transport-node', 'content-types', 'transport-node', 'schema.json')));
assert.deepEqual(schema.attributes.latitude.columnType, { type: 'decimal', args: [20, 15] });
assert.deepEqual(schema.attributes.longitude.columnType, { type: 'decimal', args: [20, 15] });

console.log('ok - pilot manifest contains only the four supplied coordinates and directional verified services');
console.log('ok - approximate fares/service remain evidence, geometry remains absent, and transfer permissions are explicit');
