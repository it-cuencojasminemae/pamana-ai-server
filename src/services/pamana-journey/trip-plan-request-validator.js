'use strict';

const { PASSENGER_CATEGORIES } = require('./fare-engine');

const MAX_REQUEST_BYTES = 8192;
const LOCATION_SOURCES = Object.freeze(['GEOAPIFY', 'USER_GPS']);
const FORBIDDEN_FACT_FIELDS = new Set([
  'routeVariantId', 'boardingNodeId', 'alightingNodeId', 'fare', 'wait',
  'servicePattern', 'service', 'vehicle',
]);
const TOP_LEVEL_FIELDS = new Set(['origin', 'destination', 'departureAt', 'passengerCategory']);
const POINT_FIELDS = new Set(['lat', 'lng', 'label', 'source']);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const plainObject = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function failure(message) {
  return Object.freeze({ ok: false, error: Object.freeze({ status: 'INVALID_REQUEST', message }) });
}

function containsForbiddenFact(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenFact);
  return Object.entries(value).some(([key, nested]) =>
    FORBIDDEN_FACT_FIELDS.has(key) || containsForbiddenFact(nested)
  );
}

function optionalText(value, { field, maxLength, allowed } = {}) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, message: `${field} is invalid.` };
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || (allowed && !allowed.includes(normalized))) {
    return { ok: false, message: `${field} is invalid.` };
  }
  return { ok: true, value: normalized };
}

function validatePoint(rawPoint, name) {
  if (!plainObject(rawPoint)) return failure(`${name} coordinates are invalid.`);
  if (Object.keys(rawPoint).some((key) => !POINT_FIELDS.has(key))) {
    return failure(`${name} contains unsupported fields.`);
  }
  const { lat, lng } = rawPoint;
  if (typeof lat !== 'number' || typeof lng !== 'number'
    || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180
    || (lat === 0 && lng === 0)) {
    return failure(`${name} coordinates are invalid.`);
  }
  const label = optionalText(rawPoint.label, { field: `${name} label`, maxLength: 200 });
  if (!label.ok) return failure(label.message);
  const source = optionalText(rawPoint.source, {
    field: `${name} source`, maxLength: 32, allowed: LOCATION_SOURCES,
  });
  if (!source.ok) return failure(source.message);
  return Object.freeze({
    ok: true,
    value: Object.freeze({ lat, lng, label: label.value, source: source.value }),
  });
}

function validateDeparture(value, now) {
  if (value === undefined || value === null) {
    const timestamp = now();
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return failure('Server departure time is unavailable.');
    return Object.freeze({ ok: true, value: date.toISOString() });
  }
  if (typeof value !== 'string' || value.length > 64 || !RFC3339.test(value)) {
    return failure('departureAt is invalid.');
  }
  const [, year, month, day, hour, minute, second] = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/
  ) || [];
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendar.getUTCFullYear() !== Number(year)
    || calendar.getUTCMonth() !== Number(month) - 1
    || calendar.getUTCDate() !== Number(day)
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return failure('departureAt is invalid.');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return failure('departureAt is invalid.');
  return Object.freeze({ ok: true, value: date.toISOString() });
}

function validateTripPlanRequest(body, { now = () => new Date() } = {}) {
  if (!plainObject(body)) return failure('Request body is invalid.');
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch {
    return failure('Request body is invalid.');
  }
  if (size > MAX_REQUEST_BYTES) return failure('Request body is too large.');
  if (containsForbiddenFact(body)) return failure('Transport journey facts must be resolved by PAMANA.');
  if (Object.keys(body).some((key) => !TOP_LEVEL_FIELDS.has(key))) {
    return failure('Request contains unsupported fields.');
  }
  const origin = validatePoint(body.origin, 'Origin');
  if (!origin.ok) return origin;
  const destination = validatePoint(body.destination, 'Destination');
  if (!destination.ok) return destination;
  const departure = validateDeparture(body.departureAt, now);
  if (!departure.ok) return departure;
  const passengerCategory = body.passengerCategory ?? 'REGULAR';
  if (typeof passengerCategory !== 'string' || !PASSENGER_CATEGORIES.includes(passengerCategory)) {
    return failure('Passenger category is invalid.');
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      origin: origin.value,
      destination: destination.value,
      departureAt: departure.value,
      passengerCategory,
    }),
  });
}

module.exports = {
  LOCATION_SOURCES,
  MAX_REQUEST_BYTES,
  validateTripPlanRequest,
};
