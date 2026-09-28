'use strict';

const REPORT_CATEGORIES = Object.freeze([
  'VEHICLE_FULL', 'LONG_WAIT', 'NO_SERVICE_OBSERVED', 'STOP_ISSUE',
  'ROUTE_INFORMATION_ISSUE', 'ACCESSIBILITY_ISSUE', 'DISRUPTION', 'OTHER',
]);
const REVIEW_STATUSES = Object.freeze(['PENDING', 'REVIEWED', 'VERIFIED', 'DISMISSED']);
const CONTEXT_SOURCES = Object.freeze(['NONE', 'SELECTED_JOURNEY', 'VISIBLE_NODE', 'ACTIVE_TRIP']);
const CONTEXT_UIDS = Object.freeze({
  route: 'api::route.route',
  route_variant: 'api::route-variant.route-variant',
  transport_node: 'api::transport-node.transport-node',
  vehicle: 'api::vehicle.vehicle',
  trip: 'api::trip.trip',
});

const identity = (record) => record?.documentId || record?.document_id || null;
const relationIdentity = (record) => identity(record) || (record?.id == null ? null : String(record.id));
const cleanText = (value) => typeof value === 'string' ? value.trim() : '';

function validateReportInput(input = {}) {
  const errors = [];
  const category = cleanText(input.report_type);
  const description = cleanText(input.description);
  const locationNote = cleanText(input.location_note);
  const contextSource = cleanText(input.context_source) || 'NONE';
  if (!REPORT_CATEGORIES.includes(category)) errors.push('REPORT_CATEGORY_INVALID');
  if (description.length < 10 || description.length > 500) errors.push('DESCRIPTION_INVALID');
  if (locationNote.length > 160) errors.push('LOCATION_NOTE_INVALID');
  if (!CONTEXT_SOURCES.includes(contextSource)) errors.push('CONTEXT_SOURCE_INVALID');

  const hasLatitude = input.latitude !== undefined && input.latitude !== null && input.latitude !== '';
  const hasLongitude = input.longitude !== undefined && input.longitude !== null && input.longitude !== '';
  if (hasLatitude !== hasLongitude) errors.push('COORDINATE_PAIR_REQUIRED');
  let latitude = null;
  let longitude = null;
  if (hasLatitude && hasLongitude) {
    latitude = Number(input.latitude);
    longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      errors.push('COORDINATES_INVALID');
    } else if (latitude === 0 && longitude === 0) {
      errors.push('NULL_ISLAND_REJECTED');
    }
  }
  const accuracy = input.location_accuracy_m == null || input.location_accuracy_m === ''
    ? null : Number(input.location_accuracy_m);
  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000)) {
    errors.push('LOCATION_ACCURACY_INVALID');
  }
  return {
    valid: errors.length === 0,
    errors,
    value: { category, description, locationNote: locationNote || null, contextSource, latitude, longitude, accuracy },
  };
}

async function findDocument(strapi, uid, documentId, populate) {
  if (documentId === undefined || documentId === null || documentId === '') return null;
  if (typeof documentId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(documentId)) {
    throw new Error('TRANSPORT_CONTEXT_ID_INVALID');
  }
  const record = await strapi.documents(uid).findOne({ documentId, ...(populate ? { populate } : {}) });
  if (!record) throw new Error('TRANSPORT_CONTEXT_NOT_FOUND');
  return record;
}

async function validateTransportContext(strapi, input = {}) {
  const requested = Object.fromEntries(Object.keys(CONTEXT_UIDS).map((key) => [key, input[key] || null]));
  if (!Object.values(requested).some(Boolean)) return { relations: {}, records: {} };
  const records = {
    route: await findDocument(strapi, CONTEXT_UIDS.route, requested.route),
    route_variant: await findDocument(strapi, CONTEXT_UIDS.route_variant, requested.route_variant, {
      route: { fields: ['route_code', 'planning_enabled', 'data_mode'] },
      route_variant_stops: { populate: { transport_node: { fields: ['node_code'] } } },
    }),
    transport_node: await findDocument(strapi, CONTEXT_UIDS.transport_node, requested.transport_node),
    vehicle: await findDocument(strapi, CONTEXT_UIDS.vehicle, requested.vehicle, {
      route: { fields: ['route_code'] }, active_route_variant: { fields: ['variant_code'] },
    }),
    trip: await findDocument(strapi, CONTEXT_UIDS.trip, requested.trip, {
      route: { fields: ['route_code'] }, route_variant: { fields: ['variant_code'] }, vehicle: { fields: ['vehicle_number'] },
    }),
  };
  for (const key of ['route', 'route_variant', 'transport_node']) {
    const record = records[key];
    if (record && (record.data_mode !== 'REAL' || record.planning_enabled !== true)) {
      throw new Error('TRANSPORT_CONTEXT_NOT_PLANNING_ELIGIBLE');
    }
  }
  for (const key of ['vehicle', 'trip']) {
    if (records[key] && records[key].data_mode !== 'REAL') throw new Error('TRANSPORT_CONTEXT_NOT_REAL');
  }
  const variantRoute = relationIdentity(records.route_variant?.route);
  if (records.route && records.route_variant && variantRoute !== identity(records.route)) {
    throw new Error('TRANSPORT_CONTEXT_RELATION_MISMATCH');
  }
  if (records.route_variant && records.transport_node) {
    const nodeId = identity(records.transport_node);
    const variantNodeIds = (records.route_variant.route_variant_stops || [])
      .map((stop) => identity(stop.transport_node));
    if (!variantNodeIds.includes(nodeId)) throw new Error('TRANSPORT_CONTEXT_RELATION_MISMATCH');
  }
  if (records.trip) {
    const checks = [
      [records.route, records.trip.route], [records.route_variant, records.trip.route_variant],
      [records.vehicle, records.trip.vehicle],
    ];
    if (checks.some(([expected, actual]) => expected && relationIdentity(actual) !== identity(expected))) {
      throw new Error('TRANSPORT_CONTEXT_RELATION_MISMATCH');
    }
  }
  return {
    records,
    relations: Object.fromEntries(Object.entries(records).filter(([, value]) => value).map(([key, value]) => [key, identity(value)])),
  };
}

function redactReport(record, { reviewer = false } = {}) {
  if (!record || typeof record !== 'object') return record;
  const output = structuredClone(record);
  delete output.passenger;
  if (!reviewer) {
    delete output.latitude;
    delete output.longitude;
    delete output.location_accuracy_m;
    delete output.review_notes;
  }
  return output;
}

module.exports = {
  CONTEXT_SOURCES, REPORT_CATEGORIES, REVIEW_STATUSES,
  redactReport, validateReportInput, validateTransportContext,
};
