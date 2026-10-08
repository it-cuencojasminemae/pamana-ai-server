'use strict';
const manifest = require('../../src/services/pamana-journey/data/connected-research-manifest.json');
const catalog = require('../../src/services/pamana-journey/data/san-fernando-landmarks.json');
const reference = code => { const node = manifest.nodes.find(n => n.node_code === code); return { lat: node.latitude, lng: node.longitude, label: node.name, source: 'PILOT_LANDMARK', landmarkId: `research-reference-${code}` }; };
const landmark = text => { const item = catalog.landmarks.find(n => n.name.includes(text)); if (!item) throw new Error(`Missing landmark ${text}`); return { lat: item.lat, lng: item.lng, label: item.name, source: 'PILOT_LANDMARK', landmarkId: item.id }; };
const pin = { lat: 15.1178, lng: 120.7029, label: 'Exact San Juan acceptance pin', source: 'MAP_PIN' };
const sanJuan = reference('RCH-SAN-JUAN-TERMINAL');
const nicolas = landmark('Nicolas');
const cases = [
  ['A', reference('RCH-PSU-MEXICO-FRONT'), nicolas],
  ['B', pin, nicolas], ['C', sanJuan, nicolas],
  ['D', reference('RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER'), nicolas],
  ['E', reference('RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'), nicolas],
  ['F', reference('RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'), landmark('SM Downtown')],
  ['G', landmark('SM Downtown'), sanJuan], ['H', landmark('Victory'), sanJuan],
  ['I', landmark('McDonald'), sanJuan], ['J', landmark('McDonald'), reference('RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD')],
  ['K', { ...landmark('Victory'), lat: 15.0394, lng: 120.6832, source: 'MAP_PIN', landmarkId: undefined, label: 'Exact San Fernando acceptance pin' }, sanJuan],
].map(([id, origin, destination]) => ({ id, request: { origin, destination, departureAt: '2026-10-08T04:00:00.000Z', passengerCategory: 'REGULAR', planningMode: 'RESEARCH_PREVIEW', accessPreference: 'WALK_ONLY' } }));
module.exports = { cases, reference, landmark };
