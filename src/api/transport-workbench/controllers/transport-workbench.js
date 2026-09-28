'use strict';

const {
  ENTITY_CONFIG,
  canAccessWorkbench,
  pickWritable,
  relationId,
  summarizeRecord,
  validateWorkbenchRecord,
} = require('../../../services/transport-data/workbench');

const TRUST_DEFAULTS = Object.freeze({
  planning_enabled: false,
  verification_status: 'RESEARCH_CANDIDATE',
  data_mode: 'REAL',
});

async function authenticatedWorkbenchUser(strapi, ctx) {
  const userId = ctx.state.user?.id;
  if (!userId) return null;
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId }, populate: ['role'],
  });
  return canAccessWorkbench(user) ? user : null;
}

function reject(ctx, errors, status = 400) {
  ctx.status = status;
  ctx.body = { error: { code: 'WORKBENCH_VALIDATION_FAILED', message: 'The record could not be saved.', details: errors } };
}

function entityConfig(ctx) {
  const config = ENTITY_CONFIG[ctx.params.entity];
  if (!config) reject(ctx, ['ENTITY_NOT_SUPPORTED'], 404);
  return config;
}

function buildFilters(entity, query = {}) {
  const filters = {};
  if (query.verification) filters.verification_status = query.verification;
  if (query.planning === 'true' || query.planning === 'false') filters.planning_enabled = query.planning === 'true';
  if (query.dataMode) filters.data_mode = query.dataMode;
  if (entity === 'transport-nodes' && query.nodeType) filters.node_type = query.nodeType;
  if (query.route) {
    if (entity === 'routes') filters.documentId = query.route;
    if (entity === 'route-variants') filters.route = { documentId: query.route };
    if (entity === 'route-variant-stops') filters.route_variant = { route: { documentId: query.route } };
    if (entity === 'fare-rules') filters.$or = [
      { route: { documentId: query.route } },
      { route_variant: { route: { documentId: query.route } } },
    ];
    if (entity === 'service-patterns') filters.route_variant = { route: { documentId: query.route } };
  }
  return filters;
}

async function ensureRelations(strapi, entity, record) {
  const definitions = {
    routes: [['cooperative', 'api::cooperative.cooperative', false]],
    'route-variants': [
      ['route', 'api::route.route', true], ['start_node', 'api::transport-node.transport-node', false],
      ['end_node', 'api::transport-node.transport-node', false],
    ],
    'route-variant-stops': [
      ['route_variant', 'api::route-variant.route-variant', true],
      ['transport_node', 'api::transport-node.transport-node', true],
    ],
    'fare-rules': [
      ['route', 'api::route.route', false], ['route_variant', 'api::route-variant.route-variant', false],
    ],
    'service-patterns': [['route_variant', 'api::route-variant.route-variant', true]],
  };
  const resolved = {};
  for (const [field, uid, required] of definitions[entity] || []) {
    const id = relationId(record[field]);
    if (!id) {
      if (required) throw new Error(`${field.toUpperCase()}_REQUIRED`);
      continue;
    }
    const found = await strapi.documents(uid).findOne({ documentId: id });
    if (!found) throw new Error(`${field.toUpperCase()}_NOT_FOUND`);
    resolved[field] = found;
  }
  if (entity === 'fare-rules' && resolved.route && resolved.route_variant) {
    const variant = await strapi.documents('api::route-variant.route-variant').findOne({
      documentId: resolved.route_variant.documentId, populate: ['route'],
    });
    if (relationId(variant?.route) !== resolved.route.documentId) throw new Error('FARE_SCOPE_MISMATCH');
  }
  return resolved;
}

async function siblingStopsFor(strapi, entity, record) {
  if (entity === 'route-variants') {
    const variantId = record.documentId;
    if (!variantId) return [];
    return strapi.documents('api::route-variant-stop.route-variant-stop').findMany({
      filters: { route_variant: { documentId: variantId } }, populate: ['transport_node'], sort: ['sequence:asc'],
    });
  }
  if (entity === 'route-variant-stops') {
    const variantId = relationId(record.route_variant);
    if (!variantId) return [];
    return strapi.documents('api::route-variant-stop.route-variant-stop').findMany({
      filters: { route_variant: { documentId: variantId } }, sort: ['sequence:asc'],
    });
  }
  return [];
}

function createTransportWorkbenchController({ strapi }) {
  return {
    async list(ctx) {
      const user = await authenticatedWorkbenchUser(strapi, ctx);
      if (!user) return ctx.forbidden('Transport workbench access is limited to LGU and Administrator roles.');
      const config = entityConfig(ctx);
      if (!config) return;
      const records = await strapi.documents(config.uid).findMany({
        filters: buildFilters(ctx.params.entity, ctx.query), populate: config.populate,
        sort: ctx.params.entity === 'route-variant-stops' ? ['sequence:asc'] : [`${config.labelField}:asc`],
        limit: 250,
      });
      ctx.body = { data: records.map((record) => summarizeRecord(ctx.params.entity, record)) };
    },

    async detail(ctx) {
      const user = await authenticatedWorkbenchUser(strapi, ctx);
      if (!user) return ctx.forbidden('Transport workbench access is limited to LGU and Administrator roles.');
      const config = entityConfig(ctx);
      if (!config) return;
      const record = await strapi.documents(config.uid).findOne({ documentId: ctx.params.documentId, populate: config.populate });
      if (!record) return ctx.notFound();
      ctx.body = { data: summarizeRecord(ctx.params.entity, record) };
    },

    async create(ctx) {
      const user = await authenticatedWorkbenchUser(strapi, ctx);
      if (!user) return ctx.forbidden('Transport workbench access is limited to LGU and Administrator roles.');
      const config = entityConfig(ctx);
      if (!config) return;
      const input = pickWritable(ctx.params.entity, ctx.request.body?.data || {});
      const supportsTrust = config.writable.includes('planning_enabled');
      const candidate = { ...(supportsTrust ? TRUST_DEFAULTS : {}), ...input };
      try {
        var relations = await ensureRelations(strapi, ctx.params.entity, candidate);
      } catch (error) {
        return reject(ctx, [error.message]);
      }
      const siblingStops = await siblingStopsFor(strapi, ctx.params.entity, candidate);
      const validation = validateWorkbenchRecord(ctx.params.entity, candidate, {
        user, confirmations: ctx.request.body?.confirmations || {}, siblingStops, relations,
      });
      if (!validation.valid) return reject(ctx, validation.errors);
      const created = await strapi.documents(config.uid).create({ data: candidate, populate: config.populate });
      ctx.status = 201;
      ctx.body = { data: summarizeRecord(ctx.params.entity, created) };
    },

    async update(ctx) {
      const user = await authenticatedWorkbenchUser(strapi, ctx);
      if (!user) return ctx.forbidden('Transport workbench access is limited to LGU and Administrator roles.');
      const config = entityConfig(ctx);
      if (!config) return;
      const existing = await strapi.documents(config.uid).findOne({ documentId: ctx.params.documentId, populate: config.populate });
      if (!existing) return ctx.notFound();
      const input = pickWritable(ctx.params.entity, ctx.request.body?.data || {});
      const candidate = { ...existing, ...input };
      try {
        var relations = await ensureRelations(strapi, ctx.params.entity, candidate);
      } catch (error) {
        return reject(ctx, [error.message]);
      }
      const siblingStops = await siblingStopsFor(strapi, ctx.params.entity, candidate);
      const validation = validateWorkbenchRecord(ctx.params.entity, candidate, {
        existing, user, confirmations: ctx.request.body?.confirmations || {}, siblingStops, relations,
      });
      if (!validation.valid) return reject(ctx, validation.errors);
      const updated = await strapi.documents(config.uid).update({
        documentId: existing.documentId, data: input, populate: config.populate,
      });
      ctx.body = { data: summarizeRecord(ctx.params.entity, updated) };
    },
  };
}

module.exports = {
  async list(ctx) { return createTransportWorkbenchController({ strapi }).list(ctx); },
  async detail(ctx) { return createTransportWorkbenchController({ strapi }).detail(ctx); },
  async create(ctx) { return createTransportWorkbenchController({ strapi }).create(ctx); },
  async update(ctx) { return createTransportWorkbenchController({ strapi }).update(ctx); },
};
