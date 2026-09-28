'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { DATA_MODE } = require('../../../services/transport-data/planning-eligibility');
const {
  REVIEW_STATUSES, redactReport, validateReportInput, validateTransportContext,
} = require('../../../services/passenger-report/report-policy');

const DUPLICATE_WINDOW_MINUTES = 5;
const SAFE_POPULATE = ['route', 'route_variant', 'transport_node', 'vehicle', 'trip'];
const REVIEW_ROLES = new Set(['LGU', 'Administrator']);
const CREATE_FIELDS = new Set([
  'report_type', 'description', 'location_note', 'latitude', 'longitude',
  'location_accuracy_m', 'context_source', 'route', 'route_variant',
  'transport_node', 'vehicle', 'trip',
]);

const isReviewer = (user) => REVIEW_ROLES.has(user?.role?.name);
const getOwnPassengerProfile = (strapi, userId) =>
  strapi.documents('api::passenger-profile.passenger-profile').findFirst({ filters: { user: { id: userId } } });
const invalidFields = (data, allowed) => Object.keys(data || {}).filter((key) => !allowed.has(key));

function contextError(ctx, error) {
  const code = String(error?.message || 'TRANSPORT_CONTEXT_INVALID');
  const messages = {
    TRANSPORT_CONTEXT_ID_INVALID: 'Transport context identifier is invalid.',
    TRANSPORT_CONTEXT_NOT_FOUND: 'The selected transport context is unavailable.',
    TRANSPORT_CONTEXT_NOT_PLANNING_ELIGIBLE: 'The selected transport context is not eligible for passenger planning.',
    TRANSPORT_CONTEXT_NOT_REAL: 'Simulated operational context cannot be attached to a real passenger report.',
    TRANSPORT_CONTEXT_RELATION_MISMATCH: 'The selected transport records do not belong to the same journey context.',
  };
  return ctx.badRequest(messages[code] || 'Transport context is invalid.');
}

module.exports = createCoreController('api::passenger-report.passenger-report', ({ strapi }) => ({
  async create(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    const passengerProfile = await getOwnPassengerProfile(strapi, ctx.state.user.id);
    if (!passengerProfile) return ctx.badRequest('No passenger profile linked to this account.');
    const input = ctx.request.body?.data;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return ctx.badRequest('Report data is required.');
    if (invalidFields(input, CREATE_FIELDS).length) return ctx.badRequest('Report contains unsupported fields.');

    const validation = validateReportInput(input);
    if (!validation.valid) return ctx.badRequest('Review the report category, description, and optional location.');
    let context;
    try {
      context = await validateTransportContext(strapi, input);
    } catch (error) {
      return contextError(ctx, error);
    }
    if (validation.value.contextSource !== 'NONE' && !Object.keys(context.relations).length) {
      return ctx.badRequest('The selected context does not identify a transport record.');
    }

    const windowStart = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const duplicateFilters = {
      passenger: { id: passengerProfile.id }, report_type: validation.value.category,
      reported_at: { $gte: windowStart },
    };
    for (const [key, value] of Object.entries(context.relations)) duplicateFilters[key] = { documentId: value };
    const recent = await strapi.documents('api::passenger-report.passenger-report').findFirst({ filters: duplicateFilters });
    if (recent) return ctx.badRequest('You already submitted this report recently. Please wait before submitting again.');

    const entity = await strapi.documents('api::passenger-report.passenger-report').create({
      data: {
        report_type: validation.value.category,
        description: validation.value.description,
        location_note: validation.value.locationNote,
        latitude: validation.value.latitude,
        longitude: validation.value.longitude,
        location_accuracy_m: validation.value.accuracy,
        context_source: validation.value.contextSource,
        review_status: 'PENDING', reviewed_at: null, review_notes: null,
        reported_at: new Date().toISOString(), data_mode: DATA_MODE.REAL,
        passenger: passengerProfile.documentId || passengerProfile.id,
        ...context.relations,
      },
      populate: SAFE_POPULATE,
    });
    const sanitized = await this.sanitizeOutput(entity, ctx);
    ctx.status = 201;
    return this.transformResponse(redactReport(sanitized));
  },

  async find(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    const reviewer = isReviewer(ctx.state.user);
    const profile = reviewer ? null : await getOwnPassengerProfile(strapi, ctx.state.user.id);
    await this.validateQuery(ctx);
    const query = await this.sanitizeQuery(ctx);
    const ownership = reviewer ? null : { passenger: { id: profile?.id ?? -1 } };
    const filters = ownership && query.filters ? { $and: [query.filters, ownership] } : ownership || query.filters;
    const { results, pagination } = await strapi.service('api::passenger-report.passenger-report').find({
      ...query, filters, populate: SAFE_POPULATE,
    });
    const sanitized = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitized.map((record) => redactReport(record, { reviewer })), { pagination });
  },

  async findOne(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    const reviewer = isReviewer(ctx.state.user);
    const report = await strapi.documents('api::passenger-report.passenger-report').findOne({
      documentId: ctx.params.id, populate: [...SAFE_POPULATE, 'passenger'],
    });
    if (!report) return ctx.notFound();
    if (!reviewer) {
      const profile = await getOwnPassengerProfile(strapi, ctx.state.user.id);
      if (!profile || report.passenger?.id !== profile.id) return ctx.notFound();
    }
    const sanitized = await this.sanitizeOutput(report, ctx);
    return this.transformResponse(redactReport(sanitized, { reviewer }));
  },

  async update(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    if (!isReviewer(ctx.state.user)) return ctx.forbidden('Only LGU or Administrator reviewers may update report status.');
    const input = ctx.request.body?.data;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || invalidFields(input, new Set(['review_status', 'review_notes'])).length) {
      return ctx.badRequest('Only review status and review notes may be updated.');
    }
    if (!REVIEW_STATUSES.includes(input.review_status) || input.review_status === 'PENDING') {
      return ctx.badRequest('Choose REVIEWED, VERIFIED, or DISMISSED.');
    }
    const notes = typeof input.review_notes === 'string' ? input.review_notes.trim() : '';
    if (notes.length < 3 || notes.length > 1000) return ctx.badRequest('Review notes must be 3 to 1000 characters.');
    const existing = await strapi.documents('api::passenger-report.passenger-report').findOne({ documentId: ctx.params.id });
    if (!existing) return ctx.notFound();
    const updated = await strapi.documents('api::passenger-report.passenger-report').update({
      documentId: ctx.params.id,
      data: { review_status: input.review_status, review_notes: notes, reviewed_at: new Date().toISOString() },
      populate: SAFE_POPULATE,
    });
    const sanitized = await this.sanitizeOutput(updated, ctx);
    return this.transformResponse(redactReport(sanitized, { reviewer: true }));
  },
}));
