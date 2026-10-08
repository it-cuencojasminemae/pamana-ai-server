'use strict';

const catalog = require('./data/san-fernando-landmarks.json');
const enabled = () => process.env.PAMANA_PILOT_LANDMARKS_ENABLED === 'true';
const entries = new Map(catalog.landmarks.map(item => [item.id, item]));

function getLandmarks({ available = enabled() } = {}) {
  return { enabled: Boolean(available), version: catalog.version, source: { ...catalog.source },
    landmarks: available ? structuredClone(catalog.landmarks) : [] };
}

function resolveLandmark(point, context) {
  if (typeof point?.landmarkId !== 'string') return null;
  let item = enabled() ? entries.get(point.landmarkId) : null;
  if (!item && context?.researchPreview) {
    const reference = require('./data/connected-research-manifest.json').nodes.find(node => `research-reference-${node.node_code}` === point.landmarkId);
    if (reference) item = { name: reference.name, lat: reference.latitude, lng: reference.longitude, id: point.landmarkId };
  }
  if (!item || Math.abs(point.lat - item.lat) > 1e-10 || Math.abs(point.lng - item.lng) > 1e-10) return null;
  return { lat: item.lat, lng: item.lng, label: item.name, source: 'PILOT_LANDMARK', landmarkId: item.id };
}

module.exports = { getLandmarks, resolveLandmark };
