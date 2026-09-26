'use strict';

const {
  DATA_MODE,
  VERIFICATION_STATUS,
} = require('./services/transport-data/planning-eligibility');

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

const ROLE_LOOKUP_ACTION = 'plugin::users-permissions.role.find';
const TRANSPORT_KNOWLEDGE_CONTENT_TYPES = [
  'route-variant.route-variant',
  'route-variant-stop.route-variant-stop',
  'transport-node.transport-node',
  'fare-rule.fare-rule',
  'service-pattern.service-pattern',
];
const TRANSPORT_KNOWLEDGE_READ_ACTIONS = TRANSPORT_KNOWLEDGE_CONTENT_TYPES.flatMap(
  (contentType) => [
    `api::${contentType}.find`,
    `api::${contentType}.findOne`,
  ]
);
const TRANSPORT_KNOWLEDGE_ADMIN_ACTIONS = TRANSPORT_KNOWLEDGE_CONTENT_TYPES.flatMap(
  (contentType) => [
    `api::${contentType}.find`,
    `api::${contentType}.findOne`,
    `api::${contentType}.create`,
    `api::${contentType}.update`,
    `api::${contentType}.delete`,
  ]
);
const REQUIRED_ROLE_PERMISSIONS = {
  Passenger: [
    ROLE_LOOKUP_ACTION,
    'api::passenger-report.passenger-report.find',
    'api::passenger-report.passenger-report.findOne',
    'api::passenger-report.passenger-report.create',
    'api::passenger-profile.passenger-profile.create',
    'api::passenger-profile.passenger-profile.find',
    'api::passenger-profile.passenger-profile.findOne',
    'api::passenger-profile.passenger-profile.update',
    'api::trip-search.trip-search.search',
    'api::pamana-ai.trip-plan.create',
    'api::live-vehicle.live-vehicle.list',
    'api::pamana-demo.pamana-demo.liveVehicles',
    ...TRANSPORT_KNOWLEDGE_READ_ACTIONS,
  ],
  Driver: [
    ROLE_LOOKUP_ACTION,
    'api::trip.trip.find',
    'api::trip.trip.findOne',
    'api::trip.trip.create',
    'api::trip.trip.update',
    'api::vehicle.vehicle.update',
    'api::vehicle-location.vehicle-location.create',
    'api::pamana-demo.pamana-demo.liveVehicles',
    ...TRANSPORT_KNOWLEDGE_READ_ACTIONS,
  ],
  LGU: [
    ROLE_LOOKUP_ACTION,
    'api::pamana-ai.pamana-ai.waitTime',
    'api::pamana-ai.pamana-ai.demand',
    'api::pamana-ai.pamana-ai.supplyDemand',
    'api::pamana-ai.pamana-ai.dashboardSummary',
    'api::pamana-ai.trip-plan.create',
    'api::live-vehicle.live-vehicle.list',
    'api::pamana-demo.pamana-demo.liveVehicles',
    'api::disruption.disruption.create',
    'api::disruption.disruption.update',
    'api::report-confidence.report-confidence.list',
    ...TRANSPORT_KNOWLEDGE_READ_ACTIONS,
  ],
  Administrator: [
    ROLE_LOOKUP_ACTION,
    'api::pamana-ai.pamana-ai.waitTime',
    'api::pamana-ai.pamana-ai.demand',
    'api::pamana-ai.pamana-ai.supplyDemand',
    'api::pamana-ai.pamana-ai.dashboardSummary',
    'api::pamana-ai.trip-plan.create',
    'api::live-vehicle.live-vehicle.list',
    'api::pamana-demo.pamana-demo.liveVehicles',
    'api::disruption.disruption.create',
    'api::disruption.disruption.update',
    'api::report-confidence.report-confidence.list',
    ...TRANSPORT_KNOWLEDGE_ADMIN_ACTIONS,
  ],
};

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
async function ensureRequiredRolePermissions(strapi) {
  const roleQuery = strapi.db.query('plugin::users-permissions.role');
  const permissionQuery = strapi.db.query(
    'plugin::users-permissions.permission'
  );

  const roles = await roleQuery.findMany({
    where: { name: { $in: Object.keys(REQUIRED_ROLE_PERMISSIONS) } },
  });

  for (const role of roles) {
    for (const action of REQUIRED_ROLE_PERMISSIONS[role.name]) {
      const existingPermission = await permissionQuery.findOne({
        where: {
          action,
          role: { id: role.id },
        },
      });

      if (!existingPermission) {
        await permissionQuery.create({
          data: {
            action,
            role: role.id,
          },
        });
      }
    }
  }
}

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
    await ensureRequiredRolePermissions(strapi);
    await ensureDefaultRegistrationRole(strapi);
  },
};
