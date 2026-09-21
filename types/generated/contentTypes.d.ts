import type { Schema, Struct } from '@strapi/strapi';

export interface AdminApiToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_tokens';
  info: {
    description: '';
    displayName: 'Api Token';
    name: 'Api Token';
    pluralName: 'api-tokens';
    singularName: 'api-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    adminPermissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::permission'
    >;
    adminUserOwner: Schema.Attribute.Relation<'manyToOne', 'admin::user'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    encryptedKey: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    expiresAt: Schema.Attribute.DateTime;
    kind: Schema.Attribute.Enumeration<['content-api', 'admin']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'content-api'>;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.Enumeration<['read-only', 'full-access', 'custom']> &
      Schema.Attribute.DefaultTo<'read-only'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminApiTokenPermission extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_token_permissions';
  info: {
    description: '';
    displayName: 'API Token Permission';
    name: 'API Token Permission';
    pluralName: 'api-token-permissions';
    singularName: 'api-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminPermission extends Struct.CollectionTypeSchema {
  collectionName: 'admin_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'Permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    actionParameters: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    apiToken: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    conditions: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::permission'> &
      Schema.Attribute.Private;
    properties: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<'manyToOne', 'admin::role'>;
    subject: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminRole extends Struct.CollectionTypeSchema {
  collectionName: 'admin_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'Role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::role'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<'oneToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<'manyToMany', 'admin::user'>;
  };
}

export interface AdminSession extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_sessions';
  info: {
    description: 'Session Manager storage';
    displayName: 'Session';
    name: 'Session';
    pluralName: 'sessions';
    singularName: 'session';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    absoluteExpiresAt: Schema.Attribute.DateTime & Schema.Attribute.Private;
    childId: Schema.Attribute.String & Schema.Attribute.Private;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deviceId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::session'> &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON & Schema.Attribute.Private;
    origin: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    sessionId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique;
    status: Schema.Attribute.String & Schema.Attribute.Private;
    type: Schema.Attribute.String & Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_tokens';
  info: {
    description: '';
    displayName: 'Transfer Token';
    name: 'Transfer Token';
    pluralName: 'transfer-tokens';
    singularName: 'transfer-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferTokenPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_token_permissions';
  info: {
    description: '';
    displayName: 'Transfer Token Permission';
    name: 'Transfer Token Permission';
    pluralName: 'transfer-token-permissions';
    singularName: 'transfer-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::transfer-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminUser extends Struct.CollectionTypeSchema {
  collectionName: 'admin_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'User';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    apiTokens: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    blocked: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    firstname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    lastname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::user'> &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    preferedLanguage: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    registrationToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordTokenExpiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Private;
    roles: Schema.Attribute.Relation<'manyToMany', 'admin::role'> &
      Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String;
  };
}

export interface ApiCooperativeCooperative extends Struct.CollectionTypeSchema {
  collectionName: 'cooperatives';
  info: {
    displayName: 'Cooperative';
    pluralName: 'cooperatives';
    singularName: 'cooperative';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    address: Schema.Attribute.Text;
    contact_number: Schema.Attribute.String;
    contact_person: Schema.Attribute.String;
    cooperative_status: Schema.Attribute.Enumeration<['active', 'inactive']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SIMULATED'>;
    drivers: Schema.Attribute.Relation<'oneToMany', 'api::driver.driver'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::cooperative.cooperative'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    routes: Schema.Attribute.Relation<'oneToMany', 'api::route.route'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    vehicles: Schema.Attribute.Relation<'oneToMany', 'api::vehicle.vehicle'>;
  };
}

export interface ApiDisruptionDisruption extends Struct.CollectionTypeSchema {
  collectionName: 'disruptions';
  info: {
    displayName: 'Disruption';
    pluralName: 'disruptions';
    singularName: 'disruption';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SIMULATED'>;
    description: Schema.Attribute.Text;
    disruption_status: Schema.Attribute.Enumeration<
      ['active', 'resolved', 'inactive']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    ends_at: Schema.Attribute.DateTime;
    latitude: Schema.Attribute.Float;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::disruption.disruption'
    > &
      Schema.Attribute.Private;
    longitude: Schema.Attribute.Float;
    publishedAt: Schema.Attribute.DateTime;
    severity: Schema.Attribute.Enumeration<
      ['low', 'moderate', 'high', 'critical']
    > &
      Schema.Attribute.Required;
    source: Schema.Attribute.String & Schema.Attribute.Required;
    starts_at: Schema.Attribute.DateTime & Schema.Attribute.Required;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    type: Schema.Attribute.Enumeration<
      [
        'flood',
        'road_closure',
        'accident',
        'weather',
        'route_suspension',
        'breakdown',
      ]
    > &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiDriverDriver extends Struct.CollectionTypeSchema {
  collectionName: 'drivers';
  info: {
    displayName: 'Driver';
    pluralName: 'drivers';
    singularName: 'driver';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    contact_number: Schema.Attribute.String;
    cooperative: Schema.Attribute.Relation<
      'manyToOne',
      'api::cooperative.cooperative'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SIMULATED'>;
    driver_number: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    driver_status: Schema.Attribute.Enumeration<['active', 'inactive']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    first_name: Schema.Attribute.String & Schema.Attribute.Required;
    last_name: Schema.Attribute.String & Schema.Attribute.Required;
    license_number: Schema.Attribute.String & Schema.Attribute.Unique;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::driver.driver'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    trips: Schema.Attribute.Relation<'oneToMany', 'api::trip.trip'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::users-permissions.user'
    >;
    vehicle: Schema.Attribute.Relation<'oneToOne', 'api::vehicle.vehicle'>;
  };
}

export interface ApiFareRuleFareRule extends Struct.CollectionTypeSchema {
  collectionName: 'fare_rules';
  info: {
    displayName: 'Fare Rule';
    pluralName: 'fare-rules';
    singularName: 'fare-rule';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    base_distance_km: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 3;
      }> &
      Schema.Attribute.DefaultTo<'PHP'>;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'REAL'>;
    effective_from: Schema.Attribute.Date;
    effective_to: Schema.Attribute.Date;
    fare_type: Schema.Attribute.Enumeration<
      ['FLAT', 'DISTANCE_BASED', 'ZONE', 'MANUAL_LOOKUP']
    > &
      Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::fare-rule.fare-rule'
    > &
      Schema.Attribute.Private;
    minimum_fare: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    notes: Schema.Attribute.Text;
    per_km_after_base: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    planning_enabled: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    publishedAt: Schema.Attribute.DateTime;
    pwd_discount_percent: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      >;
    regular_base_fare: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    rounding_rule: Schema.Attribute.String;
    route: Schema.Attribute.Relation<'manyToOne', 'api::route.route'>;
    route_variant: Schema.Attribute.Relation<
      'manyToOne',
      'api::route-variant.route-variant'
    >;
    senior_discount_percent: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      >;
    source_name: Schema.Attribute.String;
    source_reference: Schema.Attribute.Text;
    source_url: Schema.Attribute.Text;
    student_discount_percent: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    verification_status: Schema.Attribute.Enumeration<
      [
        'AUTHORITATIVE_CURRENT',
        'FIELD_VERIFIED',
        'CORROBORATED_RESEARCH',
        'HISTORICAL_UNVERIFIED',
        'SIMULATED_DEMO',
        'RESEARCH_CANDIDATE',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'RESEARCH_CANDIDATE'>;
    verified_at: Schema.Attribute.DateTime;
  };
}

export interface ApiPassengerDemandObservationPassengerDemandObservation
  extends Struct.CollectionTypeSchema {
  collectionName: 'passenger_demand_observations';
  info: {
    displayName: 'Passenger Demand Observation';
    pluralName: 'passenger-demand-observations';
    singularName: 'passenger-demand-observation';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SIMULATED'>;
    date: Schema.Attribute.Date & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::passenger-demand-observation.passenger-demand-observation'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    route: Schema.Attribute.Relation<'manyToOne', 'api::route.route'> &
      Schema.Attribute.Required;
    source: Schema.Attribute.Enumeration<
      ['observed', 'crowdsourced', 'simulation']
    > &
      Schema.Attribute.Required;
    stop: Schema.Attribute.Relation<'manyToOne', 'api::route-stop.route-stop'> &
      Schema.Attribute.Required;
    time_slot: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    waiting_passengers: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
  };
}

export interface ApiPassengerProfilePassengerProfile
  extends Struct.CollectionTypeSchema {
  collectionName: 'passenger_profiles';
  info: {
    displayName: 'Passenger Profile';
    pluralName: 'passenger-profiles';
    singularName: 'passenger-profile';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    accessibility_preferences: Schema.Attribute.JSON;
    contact_number: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    first_name: Schema.Attribute.String & Schema.Attribute.Required;
    last_name: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::passenger-profile.passenger-profile'
    > &
      Schema.Attribute.Private;
    passenger_reports: Schema.Attribute.Relation<
      'oneToMany',
      'api::passenger-report.passenger-report'
    >;
    preferred_language: Schema.Attribute.Enumeration<['english', 'filipino']>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface ApiPassengerReportPassengerReport
  extends Struct.CollectionTypeSchema {
  collectionName: 'passenger_reports';
  info: {
    displayName: 'Passenger Report';
    pluralName: 'passenger-reports';
    singularName: 'passenger-report';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SIMULATED'>;
    latitude: Schema.Attribute.Float;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::passenger-report.passenger-report'
    > &
      Schema.Attribute.Private;
    location_note: Schema.Attribute.String;
    longitude: Schema.Attribute.Float;
    passenger: Schema.Attribute.Relation<
      'manyToOne',
      'api::passenger-profile.passenger-profile'
    >;
    publishedAt: Schema.Attribute.DateTime;
    report_type: Schema.Attribute.Enumeration<
      [
        'vehicle_arrived',
        'vehicle_full',
        'seats_available',
        'route_unavailable',
        'flood',
        'vehicle_breakdown',
      ]
    > &
      Schema.Attribute.Required;
    reported_at: Schema.Attribute.DateTime & Schema.Attribute.Required;
    route: Schema.Attribute.Relation<'manyToOne', 'api::route.route'>;
    stop: Schema.Attribute.Relation<'manyToOne', 'api::route-stop.route-stop'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    vehicle: Schema.Attribute.Relation<'manyToOne', 'api::vehicle.vehicle'>;
  };
}

export interface ApiPredictionPrediction extends Struct.CollectionTypeSchema {
  collectionName: 'predictions';
  info: {
    displayName: 'Prediction';
    pluralName: 'predictions';
    singularName: 'prediction';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    confidence: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 1;
          min: 0;
        },
        number
      >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SIMULATED'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::prediction.prediction'
    > &
      Schema.Attribute.Private;
    model_version: Schema.Attribute.String & Schema.Attribute.Required;
    predicted_value: Schema.Attribute.Decimal & Schema.Attribute.Required;
    prediction_time: Schema.Attribute.DateTime & Schema.Attribute.Required;
    prediction_type: Schema.Attribute.Enumeration<['wait_time', 'demand']> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    route: Schema.Attribute.Relation<'manyToOne', 'api::route.route'> &
      Schema.Attribute.Required;
    stop: Schema.Attribute.Relation<'manyToOne', 'api::route-stop.route-stop'>;
    target_time: Schema.Attribute.DateTime & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiRouteStopRouteStop extends Struct.CollectionTypeSchema {
  collectionName: 'route_stops';
  info: {
    displayName: 'Route Stop';
    pluralName: 'route-stops';
    singularName: 'route-stop';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    accessible_toilet_nearby: Schema.Attribute.Boolean;
    covered_waiting_area: Schema.Attribute.Boolean;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'REAL'>;
    latitude: Schema.Attribute.Float & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::route-stop.route-stop'
    > &
      Schema.Attribute.Private;
    longitude: Schema.Attribute.Float & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    notes: Schema.Attribute.Text;
    passenger_demand_observations: Schema.Attribute.Relation<
      'oneToMany',
      'api::passenger-demand-observation.passenger-demand-observation'
    >;
    passenger_reports: Schema.Attribute.Relation<
      'oneToMany',
      'api::passenger-report.passenger-report'
    >;
    planning_enabled: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    predictions: Schema.Attribute.Relation<
      'oneToMany',
      'api::prediction.prediction'
    >;
    publishedAt: Schema.Attribute.DateTime;
    route: Schema.Attribute.Relation<'manyToOne', 'api::route.route'>;
    sequence: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    source_name: Schema.Attribute.String;
    source_reference: Schema.Attribute.Text;
    source_url: Schema.Attribute.Text;
    stop_type: Schema.Attribute.Enumeration<
      ['pickup', 'dropoff', 'both', 'terminal']
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    verification_status: Schema.Attribute.Enumeration<
      [
        'AUTHORITATIVE_CURRENT',
        'FIELD_VERIFIED',
        'CORROBORATED_RESEARCH',
        'HISTORICAL_UNVERIFIED',
        'SIMULATED_DEMO',
        'RESEARCH_CANDIDATE',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'RESEARCH_CANDIDATE'>;
    verified_at: Schema.Attribute.DateTime;
  };
}

export interface ApiRouteVariantStopRouteVariantStop
  extends Struct.CollectionTypeSchema {
  collectionName: 'route_variant_stops';
  info: {
    displayName: 'Route Variant Stop';
    pluralName: 'route-variant-stops';
    singularName: 'route-variant-stop';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    distance_from_variant_start_m: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    dropoff_allowed: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    instruction_template: Schema.Attribute.Text;
    is_timepoint: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::route-variant-stop.route-variant-stop'
    > &
      Schema.Attribute.Private;
    pickup_allowed: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    publishedAt: Schema.Attribute.DateTime;
    route_variant: Schema.Attribute.Relation<
      'manyToOne',
      'api::route-variant.route-variant'
    > &
      Schema.Attribute.Required;
    sequence: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    transfer_allowed: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    transport_node: Schema.Attribute.Relation<
      'manyToOne',
      'api::transport-node.transport-node'
    > &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiRouteVariantRouteVariant
  extends Struct.CollectionTypeSchema {
  collectionName: 'route_variants';
  info: {
    displayName: 'Route Variant';
    pluralName: 'route-variants';
    singularName: 'route-variant';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    active_vehicles: Schema.Attribute.Relation<
      'oneToMany',
      'api::vehicle.vehicle'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'REAL'>;
    direction: Schema.Attribute.Enumeration<
      ['OUTBOUND', 'INBOUND', 'LOOP', 'BIDIRECTIONAL_PATTERN']
    > &
      Schema.Attribute.Required;
    display_name: Schema.Attribute.String & Schema.Attribute.Required;
    effective_from: Schema.Attribute.Date;
    effective_to: Schema.Attribute.Date;
    encoded_polyline: Schema.Attribute.Text;
    end_node: Schema.Attribute.Relation<
      'manyToOne',
      'api::transport-node.transport-node'
    >;
    fare_rules: Schema.Attribute.Relation<
      'oneToMany',
      'api::fare-rule.fare-rule'
    >;
    geometry_geojson: Schema.Attribute.JSON;
    geometry_source: Schema.Attribute.Enumeration<
      [
        'FIELD_GPS',
        'AUTHORITATIVE',
        'GOOGLE_ROAD_MATCHED',
        'MANUAL_VERIFIED',
        'SIMULATED',
        'UNKNOWN',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'UNKNOWN'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::route-variant.route-variant'
    > &
      Schema.Attribute.Private;
    notes: Schema.Attribute.Text;
    operating_status: Schema.Attribute.Enumeration<
      ['ACTIVE', 'LIMITED', 'SUSPENDED', 'INACTIVE', 'UNKNOWN']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'UNKNOWN'>;
    planning_enabled: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    publishedAt: Schema.Attribute.DateTime;
    route: Schema.Attribute.Relation<'manyToOne', 'api::route.route'> &
      Schema.Attribute.Required;
    route_variant_stops: Schema.Attribute.Relation<
      'oneToMany',
      'api::route-variant-stop.route-variant-stop'
    >;
    service_patterns: Schema.Attribute.Relation<
      'oneToMany',
      'api::service-pattern.service-pattern'
    >;
    signboard_text: Schema.Attribute.String;
    source_name: Schema.Attribute.String;
    source_reference: Schema.Attribute.Text;
    source_type: Schema.Attribute.String;
    source_url: Schema.Attribute.Text;
    start_node: Schema.Attribute.Relation<
      'manyToOne',
      'api::transport-node.transport-node'
    >;
    trips: Schema.Attribute.Relation<'oneToMany', 'api::trip.trip'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    variant_code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    verification_status: Schema.Attribute.Enumeration<
      [
        'AUTHORITATIVE_CURRENT',
        'FIELD_VERIFIED',
        'CORROBORATED_RESEARCH',
        'HISTORICAL_UNVERIFIED',
        'SIMULATED_DEMO',
        'RESEARCH_CANDIDATE',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'RESEARCH_CANDIDATE'>;
    verified_at: Schema.Attribute.DateTime;
    verified_by: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface ApiRouteRoute extends Struct.CollectionTypeSchema {
  collectionName: 'routes';
  info: {
    displayName: 'Route';
    pluralName: 'routes';
    singularName: 'route';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    base_fare: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    cooperative: Schema.Attribute.Relation<
      'manyToOne',
      'api::cooperative.cooperative'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'REAL'>;
    destination: Schema.Attribute.String & Schema.Attribute.Required;
    estimated_travel_time: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    fare_rules: Schema.Attribute.Relation<
      'oneToMany',
      'api::fare-rule.fare-rule'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::route.route'> &
      Schema.Attribute.Private;
    notes: Schema.Attribute.Text;
    origin: Schema.Attribute.String & Schema.Attribute.Required;
    passenger_demand_observations: Schema.Attribute.Relation<
      'oneToMany',
      'api::passenger-demand-observation.passenger-demand-observation'
    >;
    passenger_reports: Schema.Attribute.Relation<
      'oneToMany',
      'api::passenger-report.passenger-report'
    >;
    planning_enabled: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    predictions: Schema.Attribute.Relation<
      'oneToMany',
      'api::prediction.prediction'
    >;
    publishedAt: Schema.Attribute.DateTime;
    route_code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    route_name: Schema.Attribute.String & Schema.Attribute.Required;
    route_status: Schema.Attribute.Enumeration<['active', 'inactive']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'active'>;
    route_stops: Schema.Attribute.Relation<
      'oneToMany',
      'api::route-stop.route-stop'
    >;
    route_variants: Schema.Attribute.Relation<
      'oneToMany',
      'api::route-variant.route-variant'
    >;
    source_name: Schema.Attribute.String;
    source_reference: Schema.Attribute.Text;
    source_url: Schema.Attribute.Text;
    transport_mode: Schema.Attribute.String;
    trips: Schema.Attribute.Relation<'oneToMany', 'api::trip.trip'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    vehicles: Schema.Attribute.Relation<'oneToMany', 'api::vehicle.vehicle'>;
    verification_status: Schema.Attribute.Enumeration<
      [
        'AUTHORITATIVE_CURRENT',
        'FIELD_VERIFIED',
        'CORROBORATED_RESEARCH',
        'HISTORICAL_UNVERIFIED',
        'SIMULATED_DEMO',
        'RESEARCH_CANDIDATE',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'RESEARCH_CANDIDATE'>;
    verified_at: Schema.Attribute.DateTime;
  };
}

export interface ApiServicePatternServicePattern
  extends Struct.CollectionTypeSchema {
  collectionName: 'service_patterns';
  info: {
    displayName: 'Service Pattern';
    pluralName: 'service-patterns';
    singularName: 'service-pattern';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'REAL'>;
    days_of_week: Schema.Attribute.JSON;
    dispatch_type: Schema.Attribute.Enumeration<
      [
        'SCHEDULED',
        'HEADWAY',
        'LEAVE_WHEN_FULL',
        'CONTINUOUS_UNSCHEDULED',
        'UNKNOWN',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'UNKNOWN'>;
    first_trip_time: Schema.Attribute.Time;
    headway_max_minutes: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    headway_min_minutes: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    last_trip_time: Schema.Attribute.Time;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::service-pattern.service-pattern'
    > &
      Schema.Attribute.Private;
    notes: Schema.Attribute.Text;
    planning_enabled: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    publishedAt: Schema.Attribute.DateTime;
    route_variant: Schema.Attribute.Relation<
      'manyToOne',
      'api::route-variant.route-variant'
    > &
      Schema.Attribute.Required;
    source_name: Schema.Attribute.String;
    source_reference: Schema.Attribute.Text;
    source_url: Schema.Attribute.Text;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    verification_status: Schema.Attribute.Enumeration<
      [
        'AUTHORITATIVE_CURRENT',
        'FIELD_VERIFIED',
        'CORROBORATED_RESEARCH',
        'HISTORICAL_UNVERIFIED',
        'SIMULATED_DEMO',
        'RESEARCH_CANDIDATE',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'RESEARCH_CANDIDATE'>;
    verified_at: Schema.Attribute.DateTime;
  };
}

export interface ApiTransportNodeTransportNode
  extends Struct.CollectionTypeSchema {
  collectionName: 'transport_nodes';
  info: {
    displayName: 'Transport Node';
    pluralName: 'transport-nodes';
    singularName: 'transport-node';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    accessibility_notes: Schema.Attribute.Text;
    barangay: Schema.Attribute.String;
    covered_waiting_area: Schema.Attribute.Boolean;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'REAL'>;
    ending_variants: Schema.Attribute.Relation<
      'oneToMany',
      'api::route-variant.route-variant'
    >;
    google_place_id: Schema.Attribute.String;
    latitude: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 90;
          min: -90;
        },
        number
      >;
    lighting_notes: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::transport-node.transport-node'
    > &
      Schema.Attribute.Private;
    longitude: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          max: 180;
          min: -180;
        },
        number
      >;
    municipality_city: Schema.Attribute.String;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    node_code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    node_type: Schema.Attribute.Enumeration<
      [
        'ROADSIDE_PICKUP',
        'DESIGNATED_STOP',
        'TERMINAL',
        'LOADING_BAY',
        'DROP_OFF',
        'TRANSFER_POINT',
        'TRANSPORT_HUB',
        'LANDMARK',
        'DESTINATION',
        'ESSENTIAL_SERVICE',
        'EMERGENCY_PICKUP',
      ]
    > &
      Schema.Attribute.Required;
    notes: Schema.Attribute.Text;
    planning_enabled: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    province: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    route_variant_stops: Schema.Attribute.Relation<
      'oneToMany',
      'api::route-variant-stop.route-variant-stop'
    >;
    safety_notes: Schema.Attribute.Text;
    source_name: Schema.Attribute.String;
    source_reference: Schema.Attribute.Text;
    source_url: Schema.Attribute.Text;
    starting_variants: Schema.Attribute.Relation<
      'oneToMany',
      'api::route-variant.route-variant'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    verification_status: Schema.Attribute.Enumeration<
      [
        'AUTHORITATIVE_CURRENT',
        'FIELD_VERIFIED',
        'CORROBORATED_RESEARCH',
        'HISTORICAL_UNVERIFIED',
        'SIMULATED_DEMO',
        'RESEARCH_CANDIDATE',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'RESEARCH_CANDIDATE'>;
    verified_at: Schema.Attribute.DateTime;
    wheelchair_accessible: Schema.Attribute.Boolean;
  };
}

export interface ApiTripTrip extends Struct.CollectionTypeSchema {
  collectionName: 'trips';
  info: {
    displayName: 'Trip';
    pluralName: 'trips';
    singularName: 'trip';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SIMULATED'>;
    direction: Schema.Attribute.Enumeration<['outbound', 'inbound']>;
    driver: Schema.Attribute.Relation<'manyToOne', 'api::driver.driver'> &
      Schema.Attribute.Required;
    ended_at: Schema.Attribute.DateTime;
    is_simulated: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::trip.trip'> &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    route: Schema.Attribute.Relation<'manyToOne', 'api::route.route'> &
      Schema.Attribute.Required;
    route_variant: Schema.Attribute.Relation<
      'manyToOne',
      'api::route-variant.route-variant'
    >;
    started_at: Schema.Attribute.DateTime;
    trip_status: Schema.Attribute.Enumeration<
      ['scheduled', 'active', 'completed', 'cancelled']
    > &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    vehicle: Schema.Attribute.Relation<'manyToOne', 'api::vehicle.vehicle'> &
      Schema.Attribute.Required;
    vehicle_locations: Schema.Attribute.Relation<
      'oneToMany',
      'api::vehicle-location.vehicle-location'
    >;
  };
}

export interface ApiVehicleLocationVehicleLocation
  extends Struct.CollectionTypeSchema {
  collectionName: 'vehicle_locations';
  info: {
    displayName: 'Vehicle Location';
    pluralName: 'vehicle-locations';
    singularName: 'vehicle-location';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SIMULATED'>;
    heading: Schema.Attribute.Decimal;
    latitude: Schema.Attribute.Float & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::vehicle-location.vehicle-location'
    > &
      Schema.Attribute.Private;
    longitude: Schema.Attribute.Float & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    recorded_at: Schema.Attribute.DateTime & Schema.Attribute.Required;
    speed: Schema.Attribute.Decimal;
    trip: Schema.Attribute.Relation<'manyToOne', 'api::trip.trip'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    vehicle: Schema.Attribute.Relation<'manyToOne', 'api::vehicle.vehicle'> &
      Schema.Attribute.Required;
  };
}

export interface ApiVehicleVehicle extends Struct.CollectionTypeSchema {
  collectionName: 'vehicles';
  info: {
    displayName: 'Vehicle';
    pluralName: 'vehicles';
    singularName: 'vehicle';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    active_route_variant: Schema.Attribute.Relation<
      'manyToOne',
      'api::route-variant.route-variant'
    >;
    capacity: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    cooperative: Schema.Attribute.Relation<
      'manyToOne',
      'api::cooperative.cooperative'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    current_occupancy: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    data_mode: Schema.Attribute.Enumeration<['REAL', 'SIMULATED']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SIMULATED'>;
    driver: Schema.Attribute.Relation<'oneToOne', 'api::driver.driver'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::vehicle.vehicle'
    > &
      Schema.Attribute.Private;
    low_floor: Schema.Attribute.Boolean;
    occupancy_level: Schema.Attribute.Enumeration<
      ['empty', 'low', 'moderate', 'near_full', 'full']
    >;
    passenger_reports: Schema.Attribute.Relation<
      'oneToMany',
      'api::passenger-report.passenger-report'
    >;
    plate_number: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    route: Schema.Attribute.Relation<'manyToOne', 'api::route.route'>;
    trips: Schema.Attribute.Relation<'oneToMany', 'api::trip.trip'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    vehicle_locations: Schema.Attribute.Relation<
      'oneToMany',
      'api::vehicle-location.vehicle-location'
    >;
    vehicle_number: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    vehicle_status: Schema.Attribute.Enumeration<
      ['available', 'in_transit', 'full', 'offline']
    > &
      Schema.Attribute.Required;
    vehicle_type: Schema.Attribute.String & Schema.Attribute.Required;
    wheelchair_accessible: Schema.Attribute.Boolean;
  };
}

export interface PluginContentReleasesRelease
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_releases';
  info: {
    displayName: 'Release';
    pluralName: 'releases';
    singularName: 'release';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    actions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    releasedAt: Schema.Attribute.DateTime;
    scheduledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['ready', 'blocked', 'failed', 'done', 'empty']
    > &
      Schema.Attribute.Required;
    timezone: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesReleaseAction
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_release_actions';
  info: {
    displayName: 'Release Action';
    pluralName: 'release-actions';
    singularName: 'release-action';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentType: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entryDocumentId: Schema.Attribute.String;
    isEntryValid: Schema.Attribute.Boolean;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    release: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::content-releases.release'
    >;
    type: Schema.Attribute.Enumeration<['publish', 'unpublish']> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginI18NLocale extends Struct.CollectionTypeSchema {
  collectionName: 'i18n_locale';
  info: {
    collectionName: 'locales';
    description: '';
    displayName: 'Locale';
    pluralName: 'locales';
    singularName: 'locale';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::i18n.locale'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.SetMinMax<
        {
          max: 50;
          min: 1;
        },
        number
      >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflow
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows';
  info: {
    description: '';
    displayName: 'Workflow';
    name: 'Workflow';
    pluralName: 'workflows';
    singularName: 'workflow';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentTypes: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'[]'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    stageRequiredToPublish: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::review-workflows.workflow-stage'
    >;
    stages: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflowStage
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows_stages';
  info: {
    description: '';
    displayName: 'Stages';
    name: 'Workflow Stage';
    pluralName: 'workflow-stages';
    singularName: 'workflow-stage';
  };
  options: {
    draftAndPublish: false;
    version: '1.1.0';
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    color: Schema.Attribute.String & Schema.Attribute.DefaultTo<'#4945FF'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String;
    permissions: Schema.Attribute.Relation<'manyToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workflow: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::review-workflows.workflow'
    >;
  };
}

export interface PluginUploadFile extends Struct.CollectionTypeSchema {
  collectionName: 'files';
  info: {
    description: '';
    displayName: 'File';
    pluralName: 'files';
    singularName: 'file';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    alternativeText: Schema.Attribute.Text;
    caption: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ext: Schema.Attribute.String;
    focalPoint: Schema.Attribute.JSON;
    folder: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'> &
      Schema.Attribute.Private;
    folderPath: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    formats: Schema.Attribute.JSON;
    hash: Schema.Attribute.String & Schema.Attribute.Required;
    height: Schema.Attribute.Integer;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.file'
    > &
      Schema.Attribute.Private;
    mime: Schema.Attribute.String & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    previewUrl: Schema.Attribute.Text;
    provider: Schema.Attribute.String & Schema.Attribute.Required;
    provider_metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    related: Schema.Attribute.Relation<'morphToMany'>;
    size: Schema.Attribute.Decimal & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    url: Schema.Attribute.Text & Schema.Attribute.Required;
    width: Schema.Attribute.Integer;
  };
}

export interface PluginUploadFolder extends Struct.CollectionTypeSchema {
  collectionName: 'upload_folders';
  info: {
    displayName: 'Folder';
    pluralName: 'folders';
    singularName: 'folder';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    children: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.folder'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    files: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.file'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.folder'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    parent: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'>;
    path: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    pathId: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.role'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.String & Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    >;
  };
}

export interface PluginUsersPermissionsUser
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'user';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    blocked: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    confirmationToken: Schema.Attribute.String & Schema.Attribute.Private;
    confirmed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    driver: Schema.Attribute.Relation<'oneToOne', 'api::driver.driver'>;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Private;
    passenger_profile: Schema.Attribute.Relation<
      'oneToOne',
      'api::passenger-profile.passenger-profile'
    >;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    provider: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ContentTypeSchemas {
      'admin::api-token': AdminApiToken;
      'admin::api-token-permission': AdminApiTokenPermission;
      'admin::permission': AdminPermission;
      'admin::role': AdminRole;
      'admin::session': AdminSession;
      'admin::transfer-token': AdminTransferToken;
      'admin::transfer-token-permission': AdminTransferTokenPermission;
      'admin::user': AdminUser;
      'api::cooperative.cooperative': ApiCooperativeCooperative;
      'api::disruption.disruption': ApiDisruptionDisruption;
      'api::driver.driver': ApiDriverDriver;
      'api::fare-rule.fare-rule': ApiFareRuleFareRule;
      'api::passenger-demand-observation.passenger-demand-observation': ApiPassengerDemandObservationPassengerDemandObservation;
      'api::passenger-profile.passenger-profile': ApiPassengerProfilePassengerProfile;
      'api::passenger-report.passenger-report': ApiPassengerReportPassengerReport;
      'api::prediction.prediction': ApiPredictionPrediction;
      'api::route-stop.route-stop': ApiRouteStopRouteStop;
      'api::route-variant-stop.route-variant-stop': ApiRouteVariantStopRouteVariantStop;
      'api::route-variant.route-variant': ApiRouteVariantRouteVariant;
      'api::route.route': ApiRouteRoute;
      'api::service-pattern.service-pattern': ApiServicePatternServicePattern;
      'api::transport-node.transport-node': ApiTransportNodeTransportNode;
      'api::trip.trip': ApiTripTrip;
      'api::vehicle-location.vehicle-location': ApiVehicleLocationVehicleLocation;
      'api::vehicle.vehicle': ApiVehicleVehicle;
      'plugin::content-releases.release': PluginContentReleasesRelease;
      'plugin::content-releases.release-action': PluginContentReleasesReleaseAction;
      'plugin::i18n.locale': PluginI18NLocale;
      'plugin::review-workflows.workflow': PluginReviewWorkflowsWorkflow;
      'plugin::review-workflows.workflow-stage': PluginReviewWorkflowsWorkflowStage;
      'plugin::upload.file': PluginUploadFile;
      'plugin::upload.folder': PluginUploadFolder;
      'plugin::users-permissions.permission': PluginUsersPermissionsPermission;
      'plugin::users-permissions.role': PluginUsersPermissionsRole;
      'plugin::users-permissions.user': PluginUsersPermissionsUser;
    }
  }
}
