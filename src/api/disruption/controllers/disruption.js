'use strict';

/**
 * disruption controller
 *
 * Stage 19.1 - Manual LGU Disruption Reports. Only LGU/Administrator
 * accounts get create/update permission (granted at the role level);
 * this override just validates the required fields and derives `source`
 * from the caller's own role rather than trusting an arbitrary client
 * string, so the field reliably distinguishes who reported it.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { DATA_MODE } = require('../../../services/transport-data/planning-eligibility');

const ROLE_SOURCE_LABELS = {
  lgu: 'lgu',
  administrator: 'administrator',
};

module.exports = createCoreController('api::disruption.disruption', ({ strapi }) => ({
  async create(ctx) {
    const { type, title, description, latitude, longitude, severity, starts_at, ends_at, data_mode } =
      ctx.request.body?.data || {};

    if (!type || !title || !severity || !starts_at) {
      return ctx.badRequest('"type", "title", "severity", and "starts_at" are required.');
    }

    const roleType = ctx.state.user.role?.type;
    const source = ROLE_SOURCE_LABELS[roleType] || 'manual';
    // Conservative default: a disruption is demo data unless the LGU/admin
    // explicitly identifies it as a real current advisory.
    const requestedDataMode = data_mode || DATA_MODE.SIMULATED;

    if (!Object.values(DATA_MODE).includes(requestedDataMode)) {
      return ctx.badRequest('"data_mode" must be "REAL" or "SIMULATED".');
    }

    ctx.request.body.data = {
      type,
      title,
      description,
      latitude,
      longitude,
      severity,
      starts_at,
      ends_at,
      disruption_status: 'active',
      source,
      data_mode: requestedDataMode,
    };

    return super.create(ctx);
  },

  async update(ctx) {
    const { disruption_status, ends_at, description, severity, title } = ctx.request.body?.data || {};

    ctx.request.body.data = {
      ...(disruption_status ? { disruption_status } : {}),
      ...(ends_at ? { ends_at } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(severity ? { severity } : {}),
      ...(title ? { title } : {}),
    };

    return super.update(ctx);
  },
}));
