'use strict';

const ROLE = Object.freeze({
  PASSENGER: 'Passenger',
  DRIVER: 'Driver',
  LGU: 'LGU',
  ADMINISTRATOR: 'Administrator',
});

const ROLE_LOOKUP_ACTION = 'plugin::users-permissions.role.find';
const LOGOUT_ACTION = 'plugin::users-permissions.auth.logout';
const actions = (contentType, names) => names.map((name) => `api::${contentType}.${contentType}.${name}`);

const TRANSPORT_KNOWLEDGE_TYPES = Object.freeze([
  'route-variant', 'route-variant-stop', 'transport-node', 'fare-rule', 'service-pattern',
]);
const TRANSPORT_KNOWLEDGE_READ = TRANSPORT_KNOWLEDGE_TYPES.flatMap((type) => actions(type, ['find', 'findOne']));
const TRANSPORT_KNOWLEDGE_ADMIN = TRANSPORT_KNOWLEDGE_TYPES.flatMap((type) =>
  actions(type, ['find', 'findOne', 'create', 'update', 'delete']));

const LEGACY_TRANSPORT_READ = Object.freeze([
  ...actions('route', ['find', 'findOne']),
  ...actions('route-stop', ['find', 'findOne']),
  ...actions('vehicle', ['find', 'findOne']),
  ...actions('disruption', ['find', 'findOne']),
  ...actions('prediction', ['find', 'findOne']),
]);
const OPERATIONAL_READ = Object.freeze([
  ...actions('cooperative', ['find', 'findOne']),
  ...actions('driver', ['find', 'findOne']),
  ...actions('passenger-demand-observation', ['find', 'findOne']),
  ...actions('trip', ['find', 'findOne']),
  ...actions('vehicle-location', ['find', 'findOne']),
]);
const TRANSPORT_WORKBENCH_ACTIONS = Object.freeze([
  'api::transport-workbench.transport-workbench.list',
  'api::transport-workbench.transport-workbench.detail',
  'api::transport-workbench.transport-workbench.create',
  'api::transport-workbench.transport-workbench.update',
]);

const ROLE_PERMISSION_MATRIX = Object.freeze({
  [ROLE.PASSENGER]: Object.freeze([
    ROLE_LOOKUP_ACTION,
    LOGOUT_ACTION,
    ...actions('passenger-profile', ['create', 'find', 'findOne', 'update']),
    ...actions('passenger-report', ['create', 'find', 'findOne']),
    'api::trip-search.trip-search.search',
    'api::pamana-ai.trip-plan.create',
    'api::pamana-ai.journey-explanation.create',
    'api::live-vehicle.live-vehicle.list',
    'api::pamana-demo.pamana-demo.liveVehicles',
    ...LEGACY_TRANSPORT_READ,
    ...TRANSPORT_KNOWLEDGE_READ,
  ]),
  [ROLE.DRIVER]: Object.freeze([
    ROLE_LOOKUP_ACTION,
    LOGOUT_ACTION,
    ...actions('trip', ['find', 'findOne', 'create', 'update']),
    'api::trip.trip.active',
    'api::trip.trip.options',
    ...actions('vehicle', ['find', 'findOne', 'update']),
    ...actions('vehicle-location', ['create']),
    'api::pamana-demo.pamana-demo.liveVehicles',
    ...LEGACY_TRANSPORT_READ,
    ...actions('passenger-demand-observation', ['find', 'findOne']),
    ...TRANSPORT_KNOWLEDGE_READ,
  ]),
  [ROLE.LGU]: Object.freeze([
    ROLE_LOOKUP_ACTION,
    LOGOUT_ACTION,
    'api::pamana-ai.pamana-ai.waitTime',
    'api::pamana-ai.pamana-ai.demand',
    'api::pamana-ai.pamana-ai.supplyDemand',
    'api::pamana-ai.pamana-ai.dashboardSummary',
    'api::pamana-ai.trip-plan.create',
    'api::live-vehicle.live-vehicle.list',
    'api::pamana-demo.pamana-demo.liveVehicles',
    ...actions('disruption', ['create', 'find', 'findOne', 'update']),
    'api::disruption.disruption.options',
    'api::report-confidence.report-confidence.list',
    ...actions('passenger-report', ['find', 'findOne', 'update']),
    ...OPERATIONAL_READ,
    ...LEGACY_TRANSPORT_READ,
    ...TRANSPORT_KNOWLEDGE_READ,
    ...TRANSPORT_WORKBENCH_ACTIONS,
  ]),
  [ROLE.ADMINISTRATOR]: Object.freeze([
    ROLE_LOOKUP_ACTION,
    LOGOUT_ACTION,
    'api::pamana-ai.pamana-ai.waitTime',
    'api::pamana-ai.pamana-ai.demand',
    'api::pamana-ai.pamana-ai.supplyDemand',
    'api::pamana-ai.pamana-ai.dashboardSummary',
    'api::pamana-ai.trip-plan.create',
    'api::pamana-ai.journey-explanation.create',
    'api::live-vehicle.live-vehicle.list',
    'api::pamana-demo.pamana-demo.liveVehicles',
    ...actions('disruption', ['create', 'find', 'findOne', 'update']),
    'api::disruption.disruption.options',
    'api::report-confidence.report-confidence.list',
    ...actions('passenger-report', ['find', 'findOne', 'update']),
    ...actions('cooperative', ['create', 'find', 'findOne', 'update', 'delete']),
    ...actions('driver', ['create', 'find', 'findOne', 'update', 'delete']),
    ...actions('route', ['create', 'find', 'findOne', 'update', 'delete']),
    ...actions('route-stop', ['create', 'find', 'findOne', 'update', 'delete']),
    ...actions('vehicle', ['create', 'find', 'findOne', 'update', 'delete']),
    ...actions('trip', ['find', 'findOne']),
    ...actions('vehicle-location', ['find', 'findOne']),
    ...actions('passenger-demand-observation', ['find', 'findOne']),
    ...actions('prediction', ['find', 'findOne']),
    ...TRANSPORT_KNOWLEDGE_ADMIN,
    ...TRANSPORT_WORKBENCH_ACTIONS,
  ]),
});

const MANAGED_API_PREFIXES = Object.freeze([
  'api::pamana-ai.', 'api::pamana-demo.', 'api::live-vehicle.',
  'api::transport-workbench.', 'api::passenger-report.', 'api::passenger-profile.',
  'api::trip-search.', 'api::trip.', 'api::vehicle-location.', 'api::vehicle.',
  'api::driver.', 'api::disruption.', 'api::report-confidence.',
  'api::route.', 'api::route-stop.', 'api::route-variant.', 'api::route-variant-stop.',
  'api::transport-node.', 'api::fare-rule.', 'api::service-pattern.',
  'api::cooperative.', 'api::passenger-demand-observation.', 'api::prediction.',
]);

function normalizedRoleName(user) {
  const value = user?.role?.name || user?.role?.type || '';
  const match = Object.values(ROLE).find((role) => role.toLowerCase() === String(value).toLowerCase());
  return match || null;
}

function roleAllowed(user, allowedRoles) {
  return allowedRoles.includes(normalizedRoleName(user));
}

function enforceRole(ctx, allowedRoles) {
  if (!ctx.state?.user) {
    ctx.unauthorized('Authentication is required.');
    return false;
  }
  if (!roleAllowed(ctx.state.user, allowedRoles)) {
    ctx.forbidden('You do not have permission to perform this action.');
    return false;
  }
  return true;
}

function permissionIsManaged(action) {
  return action === ROLE_LOOKUP_ACTION || action === LOGOUT_ACTION || MANAGED_API_PREFIXES.some((prefix) => action.startsWith(prefix));
}

async function reconcileRolePermissions(strapi) {
  const roleQuery = strapi.db.query('plugin::users-permissions.role');
  const permissionQuery = strapi.db.query('plugin::users-permissions.permission');
  const roles = await roleQuery.findMany({
    where: { name: { $in: ['Public', 'Authenticated', ...Object.keys(ROLE_PERMISSION_MATRIX)] } },
  });

  for (const role of roles) {
    const allowed = new Set(ROLE_PERMISSION_MATRIX[role.name] || []);
    const existing = await permissionQuery.findMany({ where: { role: { id: role.id } } });
    for (const permission of existing) {
      if (permissionIsManaged(permission.action) && !allowed.has(permission.action)) {
        await permissionQuery.delete({ where: { id: permission.id } });
      }
    }
    for (const action of allowed) {
      if (!existing.some((permission) => permission.action === action)) {
        await permissionQuery.create({ data: { action, role: role.id } });
      }
    }
  }
}

module.exports = {
  MANAGED_API_PREFIXES,
  ROLE,
  ROLE_PERMISSION_MATRIX,
  enforceRole,
  normalizedRoleName,
  permissionIsManaged,
  reconcileRolePermissions,
  roleAllowed,
};
