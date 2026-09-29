'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const {
  conservativeDisruptionDefaults,
  enforceTrustManagementRole,
  relationDocumentId,
  validateDisruption,
} = require('../../../services/disruption/disruption-foundation');
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { consumeRateLimit, validateDataEnvelope } = require('../../../services/security/request-guard');

const ROLE_SOURCE_LABELS = Object.freeze({
  lgu: 'lgu',
  administrator: 'administrator',
});

const WRITABLE_FIELDS = Object.freeze([
  'type', 'title', 'description', 'latitude', 'longitude', 'severity',
  'starts_at', 'ends_at', 'disruption_status', 'data_mode', 'effect',
  'affected_route', 'affected_route_variant', 'affected_transport_node',
  'planning_enabled', 'verification_status', 'verified_at', 'source_name',
  'source_url', 'source_reference', 'notes', 'resolved_at', 'resolution_notes',
  'geometry_source', 'geometry_geojson',
]);

function pickWritable(value = {}) {
  return Object.fromEntries(WRITABLE_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(value, field))
    .map((field) => [field, value[field]]));
}

function roleIsAdministrator(user) {
  return user?.role?.name === 'Administrator' || user?.role?.type === 'administrator';
}

function normalizeRelationValues(data) {
  const normalized = { ...data };
  for (const field of ['affected_route', 'affected_route_variant', 'affected_transport_node']) {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) continue;
    normalized[field] = relationDocumentId(normalized[field]);
  }
  return normalized;
}

async function loadTargetRecords(strapi, record) {
  const routeId = relationDocumentId(record.affected_route);
  const variantId = relationDocumentId(record.affected_route_variant);
  const nodeId = relationDocumentId(record.affected_transport_node);
  const [route, variant, node] = await Promise.all([
    routeId ? strapi.documents('api::route.route').findOne({ documentId: routeId, fields: ['route_code'] }) : null,
    variantId ? strapi.documents('api::route-variant.route-variant').findOne({
      documentId: variantId,
      fields: ['variant_code'],
      populate: { route: { fields: ['route_code'] } },
    }) : null,
    nodeId ? strapi.documents('api::transport-node.transport-node').findOne({
      documentId: nodeId,
      fields: ['node_code'],
    }) : null,
  ]);
  return { route, variant, node };
}

function rejectValidation(ctx, errors) {
  return ctx.badRequest('Invalid disruption configuration.', { errors });
}

module.exports = createCoreController('api::disruption.disruption', ({ strapi }) => ({
  async options(ctx) {
    if (!enforceRole(ctx, [ROLE.LGU, ROLE.ADMINISTRATOR])) return;
    const [routes, variants, nodes] = await Promise.all([
      strapi.documents('api::route.route').findMany({
        fields: ['route_name', 'route_code', 'route_status', 'planning_enabled'],
        sort: ['route_name:asc', 'route_code:asc'],
      }),
      strapi.documents('api::route-variant.route-variant').findMany({
        fields: ['variant_code', 'display_name', 'direction', 'operating_status', 'planning_enabled'],
        populate: { route: { fields: ['route_code', 'route_name'] } },
        sort: ['display_name:asc', 'variant_code:asc'],
      }),
      strapi.documents('api::transport-node.transport-node').findMany({
        fields: ['node_code', 'name', 'node_type', 'municipality_city', 'planning_enabled'],
        sort: ['name:asc', 'node_code:asc'],
      }),
    ]);
    ctx.body = {
      data: {
        routes: routes.map((route) => ({
          id: route.documentId,
          code: route.route_code,
          name: route.route_name,
          status: route.route_status,
          planningEnabled: route.planning_enabled === true,
        })),
        variants: variants.map((variant) => ({
          id: variant.documentId,
          code: variant.variant_code,
          name: variant.display_name,
          direction: variant.direction,
          routeId: variant.route?.documentId || null,
          routeCode: variant.route?.route_code || null,
          operatingStatus: variant.operating_status,
          planningEnabled: variant.planning_enabled === true,
        })),
        nodes: nodes.map((node) => ({
          id: node.documentId,
          code: node.node_code,
          name: node.name,
          type: node.node_type,
          locality: node.municipality_city || null,
          planningEnabled: node.planning_enabled === true,
        })),
      },
    };
  },

  async create(ctx) {
    if (!enforceRole(ctx, [ROLE.LGU, ROLE.ADMINISTRATOR])) return;
    if (!consumeRateLimit(ctx, 'disruption-write', { limit: 30, windowMs: 60_000 })) return;
    const envelope = validateDataEnvelope(ctx.request.body, { allowedFields: WRITABLE_FIELDS, maxBytes: 64 * 1024 });
    if (!envelope.ok) return ctx.badRequest('Disruption request contains unsupported or oversized data.');
    const requested = normalizeRelationValues(pickWritable(envelope.data));
    const isAdministrator = roleIsAdministrator(ctx.state.user);
    const roleErrors = enforceTrustManagementRole(requested, { isAdministrator });
    if (roleErrors.length) return rejectValidation(ctx, roleErrors);

    const roleType = ctx.state.user?.role?.type;
    const data = conservativeDisruptionDefaults({
      ...requested,
      disruption_status: 'active',
      source: ROLE_SOURCE_LABELS[roleType] || 'manual',
    });
    if (!data.type || !data.title || !data.severity || !data.starts_at) {
      return ctx.badRequest('"type", "title", "severity", and "starts_at" are required.');
    }
    const targets = await loadTargetRecords(strapi, data);
    const validation = validateDisruption(data, { requireEffect: true, targetRecords: targets });
    if (!validation.valid) return rejectValidation(ctx, validation.errors);

    const created = await strapi.documents('api::disruption.disruption').create({
      data,
      populate: ['affected_route', 'affected_route_variant', 'affected_transport_node'],
    });
    ctx.status = 201;
    ctx.body = { data: created };
  },

  async update(ctx) {
    if (!enforceRole(ctx, [ROLE.LGU, ROLE.ADMINISTRATOR])) return;
    if (!consumeRateLimit(ctx, 'disruption-write', { limit: 30, windowMs: 60_000 })) return;
    const envelope = validateDataEnvelope(ctx.request.body, { allowedFields: WRITABLE_FIELDS, maxBytes: 64 * 1024 });
    if (!envelope.ok) return ctx.badRequest('Disruption request contains unsupported or oversized data.');
    const existing = await strapi.documents('api::disruption.disruption').findOne({
      documentId: ctx.params.id,
      populate: ['affected_route', 'affected_route_variant', 'affected_transport_node'],
    });
    if (!existing) return ctx.notFound('Disruption not found.');

    const requested = normalizeRelationValues(pickWritable(envelope.data));
    const isAdministrator = roleIsAdministrator(ctx.state.user);
    const roleErrors = enforceTrustManagementRole(requested, { isAdministrator, existing });
    if (roleErrors.length) return rejectValidation(ctx, roleErrors);

    if (requested.disruption_status === 'resolved' && !requested.resolved_at) {
      requested.resolved_at = new Date().toISOString();
    }
    const merged = conservativeDisruptionDefaults({ ...existing, ...requested });
    const targets = await loadTargetRecords(strapi, merged);
    const resolvingNow = existing.disruption_status !== 'resolved'
      && requested.disruption_status === 'resolved';
    const validation = validateDisruption(merged, {
      requireEffect: false,
      requireResolutionDetails: resolvingNow,
      targetRecords: targets,
    });
    if (!validation.valid) return rejectValidation(ctx, validation.errors);

    const updated = await strapi.documents('api::disruption.disruption').update({
      documentId: existing.documentId,
      data: requested,
      populate: ['affected_route', 'affected_route_variant', 'affected_transport_node'],
    });
    ctx.body = { data: updated };
  },
}));

module.exports.loadTargetRecords = loadTargetRecords;
module.exports.normalizeRelationValues = normalizeRelationValues;
module.exports.pickWritable = pickWritable;
