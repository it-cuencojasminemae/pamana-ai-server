'use strict';

const EARTH_RADIUS_METERS = 6371008.8;
const radians = (degrees) => degrees * Math.PI / 180;

function distanceMeters(first, second) {
  const lat1 = radians(first[1]);
  const lat2 = radians(second[1]);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(second[0] - first[0]);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

function interpolateLineString(coordinates, progress) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error('INVALID_LINESTRING');
  const bounded = Math.min(1, Math.max(0, Number(progress) || 0));
  const segments = coordinates.slice(1).map((coordinate, index) => ({
    from: coordinates[index], to: coordinate,
    distance: distanceMeters(coordinates[index], coordinate),
  }));
  const totalDistance = segments.reduce((sum, segment) => sum + segment.distance, 0);
  if (!Number.isFinite(totalDistance) || totalDistance <= 0) return Object.freeze([...coordinates[0]]);
  const target = totalDistance * bounded;
  let travelled = 0;
  for (const segment of segments) {
    if (travelled + segment.distance >= target) {
      const local = segment.distance ? (target - travelled) / segment.distance : 0;
      return Object.freeze([
        segment.from[0] + (segment.to[0] - segment.from[0]) * local,
        segment.from[1] + (segment.to[1] - segment.from[1]) * local,
      ]);
    }
    travelled += segment.distance;
  }
  return Object.freeze([...coordinates.at(-1)]);
}

module.exports = { distanceMeters, interpolateLineString };
