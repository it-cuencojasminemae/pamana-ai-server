'use strict';

const ROAD_GEOMETRY_SOURCES = new Set(['FIELD_GPS', 'AUTHORITATIVE', 'GOOGLE_ROAD_MATCHED', 'MANUAL_VERIFIED']);
const radians = (value) => value * Math.PI / 180;
const validPoint = (p) => Array.isArray(p) && p.length >= 2
  && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180
  && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90;

// Great-circle lengths of consecutive ROAD polyline segments, never the
// straight-line distance between a passenger's origin and destination.
function segmentLength(a, b) {
  const dLat = radians(b[1] - a[1]);
  const dLng = radians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function decodePolyline(encoded) {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > 1000000) return null;
  let index = 0;
  let lat = 0;
  let lng = 0;
  const points = [];
  function delta() {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('INVALID_POLYLINE');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('INVALID_POLYLINE');
      result += (byte & 31) * 2 ** shift;
      shift += 5;
    } while (byte >= 32);
    return result % 2 ? -(Math.floor(result / 2) + 1) : result / 2;
  }
  try {
    while (index < encoded.length) {
      lat += delta();
      lng += delta();
      points.push([lng / 1e5, lat / 1e5]);
    }
  } catch { return null; }
  return points.length >= 2 && points.every(validPoint) ? points : null;
}

function roadLine(variant) {
  if (!ROAD_GEOMETRY_SOURCES.has(variant.geometry_source)) return null;
  const geo = variant.geometry_geojson?.type === 'Feature'
    ? variant.geometry_geojson.geometry : variant.geometry_geojson;
  let line = null;
  if (geo?.type === 'LineString') line = geo.coordinates;
  if (geo?.type === 'MultiLineString' && Array.isArray(geo.coordinates)) {
    line = [];
    for (const part of geo.coordinates) {
      if (!Array.isArray(part) || part.length < 2 || !part.every(validPoint)) return null;
      // Do not price an invented bridge between disconnected geometry pieces.
      if (line.length && segmentLength(line[line.length - 1], part[0]) > 0.1) return null;
      line.push(...(line.length ? part.slice(1) : part));
    }
  }
  if (line) return line.length >= 2 && line.every(validPoint) ? line : null;
  return decodePolyline(variant.encoded_polyline);
}

function offsetOnLine(line, node) {
  if (!Number.isFinite(node?.lat) || !Number.isFinite(node?.lng)) return null;
  const point = [node.lng, node.lat];
  const candidates = [];
  let offset = 0;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const scale = Math.cos(radians(node.lat));
    const dx = (b[0] - a[0]) * scale;
    const dy = b[1] - a[1];
    const length = segmentLength(a, b);
    if (length > 0) {
      const t = Math.max(0, Math.min(1,
        (((point[0] - a[0]) * scale) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      const snapped = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      candidates.push({ distance: segmentLength(point, snapped), offset: offset + t * length });
    }
    offset += length;
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  if (!best || best.distance > 30) return null;
  // A looping/self-crossing road needs explicit cumulative stop distances.
  if (candidates.some((c) => c.distance <= best.distance + 1 && Math.abs(c.offset - best.offset) > 50)) return null;
  return best.offset;
}

function geometryStopOffsets(rawVariant, stops) {
  const line = roadLine(rawVariant);
  return line ? stops.map((stop) => offsetOnLine(line, stop.node)) : [];
}

function distanceForEdge(edge) {
  const stops = edge.variant.stops.filter((stop) => stop.sequence >= edge.boardStop.sequence
    && stop.sequence <= edge.alightStop.sequence);
  const cumulative = stops.map((stop) => stop.distanceFromVariantStartMeters);
  const board = cumulative[0];
  const alight = cumulative[cumulative.length - 1];
  const present = cumulative.filter((value) => Number.isFinite(value));
  if (Number.isFinite(board) && Number.isFinite(alight) && board >= 0 && alight > board
    && present.every((value, i) => value >= 0 && (i === 0 || value >= present[i - 1]))) {
    return { meters: alight - board, source: 'STORED_ROUTE_STOP_DISTANCE' };
  }
  const offsets = stops.map((stop) => stop.geometryOffsetMeters);
  if (offsets.every(Number.isFinite) && offsets.length >= 2
    && offsets.every((value, i) => i === 0 || value >= offsets[i - 1])
    && offsets[offsets.length - 1] > offsets[0]) {
    return { meters: offsets[offsets.length - 1] - offsets[0], source: 'STORED_ROAD_GEOMETRY' };
  }
  return { meters: null, source: null };
}

module.exports = { distanceForEdge, geometryStopOffsets, roadLine, decodePolyline };
