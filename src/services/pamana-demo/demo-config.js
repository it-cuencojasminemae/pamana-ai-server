'use strict';

function isDemoModeEnabled(environment = process.env) {
  return String(environment.PAMANA_DEMO_MODE_ENABLED || '').trim().toLowerCase() === 'true';
}

module.exports = { isDemoModeEnabled };
