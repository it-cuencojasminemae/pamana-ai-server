'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
let boundary = null, verification = null;
let cityBoundary = null, cityVerification = null;
try {
  cityBoundary = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/san-fernando-psa-boundary.geojson'), 'utf8'));
  cityVerification = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/san-fernando-boundary-verification.json'), 'utf8'));
} catch { /* City pins fail independently; San Juan and named places remain usable. */ }
try {
  boundary = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/san-juan-psa-boundary.geojson'), 'utf8').replace(/^\uFEFF/, '')).features[0];
  verification = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/san-juan-boundary-verification.json'), 'utf8'));
} catch { /* A missing or damaged boundary disables pins, never the existing planner. */ }

function validPosition(p) {
  return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
    && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}

function validBoundary(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  return Array.isArray(polygons) && polygons.length > 0 && polygons.every(polygon =>
    Array.isArray(polygon) && polygon.length > 0 && polygon.every(ring =>
      Array.isArray(ring) && ring.length >= 4 && ring.every(validPosition)
      && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]));
}

// Outer edges are included; holes (including their edges) are excluded.
function ringContains(position, ring) {
  const [x, y] = position;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) <= 1e-12 && x >= Math.min(ax, bx) - 1e-12 && x <= Math.max(ax, bx) + 1e-12
      && y >= Math.min(ay, by) - 1e-12 && y <= Math.max(ay, by) + 1e-12) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function containsPoint(geometry, point) {
  const position = [point?.lng, point?.lat];
  if (!validPosition(position) || !validBoundary(geometry)) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(rings => ringContains(position, rings[0]) && !rings.slice(1).some(ring => ringContains(position, ring)));
}

function getPinArea({ enabled = process.env.PAMANA_MAP_PINS_ENABLED === 'true', includeSanFernando = true } = {}) {
  const p = boundary?.properties || {};
  const verified = Boolean(verification?.status === 'VERIFIED_INDICATIVE'
    && p.brgy_name === 'San Juan' && p.city_name === 'Mexico' && p.prov_name === 'Pampanga'
    && p.psgc_10d === verification.psgc && validBoundary(boundary.geometry)
    && createHash('sha256').update(JSON.stringify(boundary.geometry)).digest('hex') === verification.geometrySha256
    && Array.isArray(verification.referencePoints) && verification.referencePoints.length >= 2
    && verification.referencePoints.every(ref => containsPoint(boundary.geometry, ref) === ref.expectedInside));
  const cityVerified = Boolean(cityVerification?.status === 'VERIFIED_INDICATIVE' && cityBoundary?.properties?.city_name === 'City of San Fernando'
    && cityBoundary.properties.prov_name === 'Pampanga' && cityBoundary.properties.city_code === cityVerification.cityCode
    && cityBoundary.properties.barangayCount === 35 && validBoundary(cityBoundary.geometry)
    && createHash('sha256').update(JSON.stringify(cityBoundary.geometry)).digest('hex') === cityVerification.geometrySha256
    && cityVerification.referencePoints?.length >= 3 && cityVerification.referencePoints.every(ref => containsPoint(cityBoundary.geometry, ref) === ref.expectedInside));
  const cityEnabled = includeSanFernando && process.env.PAMANA_CSF_MAP_PINS_ENABLED === 'true' && cityVerified;
  const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const displayedBoundary = verified && cityEnabled ? { type: 'Feature', properties: { pilotAreas: ['San Juan, Mexico', 'City of San Fernando'] },
    geometry: { type: 'MultiPolygon', coordinates: [...polygons(boundary.geometry), ...polygons(cityBoundary.geometry)] } } : boundary;
  return {
    id: 'san-juan-mexico-pampanga', label: cityEnabled ? 'San Juan, Mexico and City of San Fernando' : 'San Juan, Mexico, Pampanga',
    enabled: Boolean(enabled && verified), verified,
    reason: !verified ? 'BOUNDARY_UNVERIFIED' : enabled ? null : 'PINS_DISABLED',
    boundary: verified ? structuredClone(displayedBoundary) : null,
    // Presentation is independent of geographic authorization: show San Juan,
    // while validating against every independently enabled pilot area.
    displayBoundary: verified ? structuredClone(boundary) : null,
    additionalAreas: [{ id: 'city-of-san-fernando-pampanga', verified: cityVerified, enabled: Boolean(enabled && verified && cityEnabled), sourceUrl: cityVerification?.sourceUrl || '', verifiedAt: cityVerified ? cityVerification.verifiedAt : null }],
    source: verification?.source || '', sourceUrl: verification?.sourceUrl || '',
    verifiedAt: verified ? verification.verifiedAt : null,
    notice: 'PSA indicative barangay boundary; used for passenger pin selection, not a legal boundary survey.',
    travelTimeEnabled: process.env.PAMANA_TRAVEL_TIME_ENABLED === 'true',
  };
}

function pinAllowed(point, area = getPinArea()) {
  return Boolean(area.enabled && area.verified && containsPoint(area.boundary?.geometry, point));
}

module.exports = { containsPoint, validBoundary, getPinArea, pinAllowed };
