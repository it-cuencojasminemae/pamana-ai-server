'use strict';

const {
  DATA_MODE,
  VERIFICATION_STATUS,
} = require('./services/transport-data/planning-eligibility');
const { reconcileRolePermissions } = require('./services/security/access-control');

const ROUTE_TRUTH_TABLES = ['routes', 'route_stops'];
const OPERATIONAL_DATA_TABLES = [
  'cooperatives',
  'drivers',
  'vehicles',
  'trips',
  'vehicle_locations',
  'passenger_reports',
  'disruptions',
  'passenger_demand_observations',
  'predictions',
];


/**
 * Strapi sync adds these columns without database-level NOT NULL/default
 * constraints. Backfill old rows conservatively, then harden the columns so
 * raw imports cannot accidentally turn legacy/demo records into planning data.
 * This is additive and idempotent; no route or operational rows are deleted.
 */
async function hardenDataTrustColumns(strapi) {
  if (strapi.db.dialect.client !== 'postgres') {
    return;
  }

  const knex = strapi.db.connection;

  await knex.transaction(async (trx) => {
    for (const tableName of ROUTE_TRUTH_TABLES) {
      const requiredColumns = [
        'planning_enabled',
        'verification_status',
        'data_mode',
      ];
      const columnChecks = await Promise.all(
        requiredColumns.map((column) => trx.schema.hasColumn(tableName, column))
      );

      if (columnChecks.some((exists) => !exists)) {
        continue;
      }

      await trx(tableName).whereNull('planning_enabled').update({ planning_enabled: false });
      await trx(tableName)
        .whereNull('verification_status')
        .update({ verification_status: VERIFICATION_STATUS.HISTORICAL_UNVERIFIED });
      await trx(tableName).whereNull('data_mode').update({ data_mode: DATA_MODE.SIMULATED });

      await trx.schema.alterTable(tableName, (table) => {
        table.boolean('planning_enabled').notNullable().defaultTo(false).alter();
        table
          .string('verification_status')
          .notNullable()
          .defaultTo(VERIFICATION_STATUS.RESEARCH_CANDIDATE)
          .alter();
        table.string('data_mode').notNullable().defaultTo(DATA_MODE.REAL).alter();
      });
    }

    for (const tableName of OPERATIONAL_DATA_TABLES) {
      const hasDataMode = await trx.schema.hasColumn(tableName, 'data_mode');
      if (!hasDataMode) continue;

      await trx(tableName).whereNull('data_mode').update({ data_mode: DATA_MODE.SIMULATED });
      await trx.schema.alterTable(tableName, (table) => {
        table.string('data_mode').notNullable().defaultTo(DATA_MODE.SIMULATED).alter();
      });
    }

    const disruptionColumns = [
      'planning_enabled',
      'verification_status',
      'geometry_source',
    ];
    const disruptionColumnChecks = await Promise.all(
      disruptionColumns.map((column) => trx.schema.hasColumn('disruptions', column))
    );
    if (disruptionColumnChecks.every(Boolean)) {
      // Existing disruption rows remain conservative. No effect, target, or
      // geometry is inferred from their text or coordinates.
      await trx('disruptions').whereNull('planning_enabled').update({ planning_enabled: false });
      await trx('disruptions')
        .whereNull('verification_status')
        .update({ verification_status: VERIFICATION_STATUS.RESEARCH_CANDIDATE });
      await trx('disruptions').whereNull('geometry_source').update({ geometry_source: 'UNKNOWN' });
      await trx.schema.alterTable('disruptions', (table) => {
        table.boolean('planning_enabled').notNullable().defaultTo(false).alter();
        table.string('verification_status')
          .notNullable()
          .defaultTo(VERIFICATION_STATUS.RESEARCH_CANDIDATE)
          .alter();
        table.string('geometry_source').notNullable().defaultTo('UNKNOWN').alter();
      });
    }
  });
}

async function hardenPassengerReportColumns(strapi) {
  if (strapi.db.dialect.client !== 'postgres') return;
  const knex = strapi.db.connection;
  const required = ['review_status', 'context_source'];
  if (!(await Promise.all(required.map((column) => knex.schema.hasColumn('passenger_reports', column)))).every(Boolean)) return;
  await knex.transaction(async (trx) => {
    await trx('passenger_reports').whereNull('review_status').update({ review_status: 'PENDING' });
    await trx('passenger_reports').whereNull('context_source').update({ context_source: 'NONE' });
    await trx.schema.alterTable('passenger_reports', (table) => {
      table.string('review_status').notNullable().defaultTo('PENDING').alter();
      table.string('context_source').notNullable().defaultTo('NONE').alter();
    });
  });
}

/**
 * `/api/users/me?populate=role` is sanitized against the caller's content API
 * permissions. Without permission to read roles, Strapi silently removes the
 * populated role and the frontend cannot choose a role-specific dashboard.
 *
 * Keep this idempotent so fresh databases and restored databases behave the
 * same way without requiring a manual permissions change in the admin panel.
 */
/**
 * `POST /api/auth/local/register` (used by the passenger self-service
 * register flow, see useAuth.ts) assigns whatever role is configured as
 * the plugin's "default role for authenticated users" - out of the box
 * that's Strapi's own built-in "authenticated" role, not this app's
 * "Passenger" role. Left on the default, every self-registered user ends
 * up unable to create their passenger profile (Passenger-only permission)
 * and never resolves to a role-specific dashboard. Force it to "passenger"
 * so fresh/restored databases match the intended self-service signup flow
 * without a manual admin panel change.
 */
async function ensureDefaultRegistrationRole(strapi) {
  const pluginStore = strapi.store({
    type: 'plugin',
    name: 'users-permissions',
    key: 'advanced',
  });

  const settings = await pluginStore.get();

  if (settings && settings.default_role !== 'passenger') {
    await pluginStore.set({ value: { ...settings, default_role: 'passenger' } });
  }
}

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    await hardenDataTrustColumns(strapi);
    await hardenPassengerReportColumns(strapi);
    await reconcileRolePermissions(strapi);
    await ensureDefaultRegistrationRole(strapi);
  },
};
