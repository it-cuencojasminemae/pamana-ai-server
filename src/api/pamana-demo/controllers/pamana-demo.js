'use strict';

const { isDemoModeEnabled } = require('../../../services/pamana-demo/demo-config');
const { listScenarios } = require('../../../services/pamana-demo/scenario-loader');
const { simulateScenarioSnapshot } = require('../../../services/pamana-demo/vehicle-simulator');

const serverStartedAt = new Date();

function createLiveVehiclesHandler({
  enabled = () => isDemoModeEnabled(),
  now = () => new Date(),
  startedAt = serverStartedAt,
  simulate = simulateScenarioSnapshot,
} = {}) {
  return async function liveVehicles(ctx) {
    if (!ctx.state?.user) return ctx.unauthorized('Authentication is required.');
    if (!enabled()) {
      ctx.status = 403;
      ctx.body = Object.freeze({
        status: 'SIMULATION_DISABLED', dataMode: 'SIMULATED', simulation: true,
        message: 'Simulated live vehicles are disabled on this server.', vehicles: Object.freeze([]),
      });
      return;
    }
    try {
      const elapsed = ctx.query?.elapsedSeconds;
      const snapshot = simulate({
        scenarioId: ctx.query?.scenario,
        now: now(), startedAt,
        ...(elapsed === undefined ? {} : { elapsedSeconds: elapsed }),
      });
      ctx.status = 200;
      ctx.body = Object.freeze({ status: 'SIMULATION_READY', ...snapshot, scenarios: Object.freeze(listScenarios()) });
    } catch (error) {
      ctx.status = ['SIMULATION_SCENARIO_NOT_FOUND', 'INVALID_SIMULATION_TIME'].includes(error?.message) ? 400 : 503;
      ctx.body = Object.freeze({
        status: error?.message === 'SIMULATION_SCENARIO_NOT_FOUND' ? 'INVALID_SCENARIO' : 'SIMULATION_UNAVAILABLE',
        dataMode: 'SIMULATED', simulation: true,
        message: error?.message === 'SIMULATION_SCENARIO_NOT_FOUND'
          ? 'The requested simulation scenario is unavailable.'
          : 'The simulated vehicle feed is temporarily unavailable.',
        vehicles: Object.freeze([]),
      });
    }
  };
}

module.exports = { liveVehicles: createLiveVehiclesHandler(), createLiveVehiclesHandler };
