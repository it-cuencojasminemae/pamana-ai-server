'use strict';

const TRANSPORT_MODES = Object.freeze([
  'PUJ_TRADITIONAL',
  'PUJ_MODERN',
  'TRICYCLE',
  'BUS',
  'UV_EXPRESS',
  'EMERGENCY_SERVICE',
]);

const PLANNING_OPERATING_STATUSES = Object.freeze(['ACTIVE', 'LIMITED']);

const LEG_TYPE = Object.freeze({
  WALK: 'WALK',
  TRANSIT: 'TRANSIT',
  TRANSFER: 'TRANSFER',
});

const MAX_TRANSFERS = 1;

module.exports = {
  LEG_TYPE,
  MAX_TRANSFERS,
  PLANNING_OPERATING_STATUSES,
  TRANSPORT_MODES,
};
