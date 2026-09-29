'use strict';

/**
 * passenger-profile controller
 *
 * accessibility_preferences is a free-form Strapi `json` field, so it has
 * no schema-level shape - validated and normalized here instead. It always
 * stores all four known keys as explicit booleans (never null/missing), so
 * a future consumer (Phase 17's recommendation engine) never has to treat
 * an absent key as "confirmed accessible" - absent always means false.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { validateDataEnvelope } = require('../../../services/security/request-guard');

const ACCESSIBILITY_KEYS = ['pwd', 'senior_citizen', 'minimize_walking', 'fewer_transfers'];
const PROFILE_FIELDS = ['first_name', 'last_name', 'contact_number', 'preferred_language', 'accessibility_preferences'];

const defaultAccessibilityPreferences = () =>
  ACCESSIBILITY_KEYS.reduce((acc, key) => ({ ...acc, [key]: false }), {});

const validateAccessibilityPreferences = (input) => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('"accessibility_preferences" must be an object.');
  }

  const unknownKeys = Object.keys(input).filter((key) => !ACCESSIBILITY_KEYS.includes(key));

  if (unknownKeys.length > 0) {
    throw new Error(
      `Unknown accessibility_preferences key(s): ${unknownKeys.join(', ')}. Allowed: ${ACCESSIBILITY_KEYS.join(', ')}.`
    );
  }

  for (const key of ACCESSIBILITY_KEYS) {
    if (key in input && typeof input[key] !== 'boolean') {
      throw new Error(`"accessibility_preferences.${key}" must be a boolean.`);
    }
  }

  return input;
};

const validateProfileFields = (input) => {
  const text = (field, maximum, required = false) => {
    const value = input[field];
    if (value === undefined || value === null || value === '') return !required;
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum;
  };
  return text('first_name', 100) && text('last_name', 100)
    && text('contact_number', 40)
    && (input.preferred_language === undefined || ['english', 'filipino'].includes(input.preferred_language));
};

module.exports = createCoreController(
  'api::passenger-profile.passenger-profile',
  ({ strapi }) => ({
    async create(ctx) {
      if (!enforceRole(ctx, [ROLE.PASSENGER])) return;
      const envelope = validateDataEnvelope(ctx.request.body, { allowedFields: PROFILE_FIELDS, maxBytes: 8192 });
      if (!envelope.ok) return ctx.badRequest('Passenger profile contains unsupported or oversized data.');
      if (!validateProfileFields(envelope.data)) return ctx.badRequest('Passenger profile fields are invalid.');
      const userId = ctx.state.user.id;

      const existing = await strapi
        .documents('api::passenger-profile.passenger-profile')
        .findFirst({ filters: { user: { id: userId } } });

      if (existing) {
        return ctx.badRequest('Passenger profile already exists for this account.');
      }

      if (ctx.request.body.data) {
        delete ctx.request.body.data.user;

        if ('accessibility_preferences' in ctx.request.body.data) {
          try {
            const provided = validateAccessibilityPreferences(
              ctx.request.body.data.accessibility_preferences
            );
            ctx.request.body.data.accessibility_preferences = {
              ...defaultAccessibilityPreferences(),
              ...provided,
            };
          } catch (err) {
            return ctx.badRequest(err.message);
          }
        } else {
          ctx.request.body.data.accessibility_preferences = defaultAccessibilityPreferences();
        }
      }

      const result = await super.create(ctx);
      const documentId = result?.data?.documentId;

      if (!documentId) {
        return result;
      }

      await strapi.documents('api::passenger-profile.passenger-profile').update({
        documentId,
        data: { user: userId },
      });

      const updated = await strapi
        .documents('api::passenger-profile.passenger-profile')
        .findOne({ documentId });

      const sanitized = await this.sanitizeOutput(updated, ctx);

      return this.transformResponse(sanitized);
    },

    async find(ctx) {
      if (!enforceRole(ctx, [ROLE.PASSENGER])) return;
      // Filtering by the `user` relation directly hits Strapi's restricted-
      // relations check (the Passenger role has no `find` permission on the
      // users-permissions user content-type) - same class of issue worked
      // around in trip.js. Resolve the caller's own profile id server-side
      // first, then filter by `id`, a plain scalar field.
      const profile = await strapi
        .documents('api::passenger-profile.passenger-profile')
        .findFirst({ filters: { user: { id: ctx.state.user.id } }, fields: ['id'] });

      ctx.query = {
        ...ctx.query,
        filters: {
          ...(ctx.query.filters || {}),
          id: { $in: profile ? [profile.id] : [-1] },
        },
      };

      return super.find(ctx);
    },

    async findOne(ctx) {
      if (!enforceRole(ctx, [ROLE.PASSENGER])) return;
      const profile = await strapi
        .documents('api::passenger-profile.passenger-profile')
        .findOne({ documentId: ctx.params.id, populate: ['user'] });

      if (!profile || profile.user?.id !== ctx.state.user.id) {
        return ctx.notFound();
      }

      return super.findOne(ctx);
    },

    async update(ctx) {
      if (!enforceRole(ctx, [ROLE.PASSENGER])) return;
      const envelope = validateDataEnvelope(ctx.request.body, { allowedFields: PROFILE_FIELDS, maxBytes: 8192 });
      if (!envelope.ok) return ctx.badRequest('Passenger profile contains unsupported or oversized data.');
      if (!validateProfileFields(envelope.data)) return ctx.badRequest('Passenger profile fields are invalid.');
      const profile = await strapi
        .documents('api::passenger-profile.passenger-profile')
        .findOne({ documentId: ctx.params.id, populate: ['user'] });

      if (!profile || profile.user?.id !== ctx.state.user.id) {
        return ctx.notFound();
      }

      if (ctx.request.body.data) {
        delete ctx.request.body.data.user;

        if ('accessibility_preferences' in ctx.request.body.data) {
          try {
            const provided = validateAccessibilityPreferences(
              ctx.request.body.data.accessibility_preferences
            );
            const current =
              profile.accessibility_preferences && typeof profile.accessibility_preferences === 'object'
                ? profile.accessibility_preferences
                : {};
            ctx.request.body.data.accessibility_preferences = {
              ...defaultAccessibilityPreferences(),
              ...current,
              ...provided,
            };
          } catch (err) {
            return ctx.badRequest(err.message);
          }
        }
      }

      return super.update(ctx);
    },
  })
);
