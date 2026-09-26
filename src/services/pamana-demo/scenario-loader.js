'use strict';

const { SYNTHETIC_DIRECT_SCENARIO } = require('./scenarios/synthetic-direct');
const { SYNTHETIC_STALE_SCENARIO } = require('./scenarios/synthetic-stale');

const SCENARIOS = new Map([
  [SYNTHETIC_DIRECT_SCENARIO.scenarioId, SYNTHETIC_DIRECT_SCENARIO],
  [SYNTHETIC_STALE_SCENARIO.scenarioId, SYNTHETIC_STALE_SCENARIO],
]);

function isCoordinate(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180
    && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

function validateScenario(scenario) {
  const coordinates = scenario?.routeGeometry?.coordinates;
  if (scenario?.dataMode !== 'SIMULATED'
    || scenario?.routeGeometry?.type !== 'LineString'
    || !Array.isArray(coordinates) || coordinates.length < 2
    || !coordinates.every(isCoordinate)
    || !Number.isFinite(scenario?.durationSeconds) || scenario.durationSeconds <= 0
    || !Array.isArray(scenario?.vehicles)) {
    throw new Error('INVALID_SIMULATION_SCENARIO');
  }
  return scenario;
}

function loadScenario(scenarioId = SYNTHETIC_DIRECT_SCENARIO.scenarioId) {
  const scenario = SCENARIOS.get(String(scenarioId));
  if (!scenario) throw new Error('SIMULATION_SCENARIO_NOT_FOUND');
  return validateScenario(scenario);
}

function listScenarios() {
  return [...SCENARIOS.values()].map(({ scenarioId, name, notice }) => Object.freeze({ scenarioId, name, notice }));
}

module.exports = { loadScenario, listScenarios, validateScenario };
