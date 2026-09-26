'use strict';

const { evaluateLocationFreshness, FRESHNESS_STATUS } = require('../pamana-journey/vehicle-freshness');
const { interpolateLineString } = require('./position-interpolator');
const { elapsedSimulationSeconds } = require('./simulation-clock');
const { loadScenario, validateScenario } = require('./scenario-loader');

const OCCUPANCY = new Set(['AVAILABLE', 'NEAR_FULL', 'FULL', 'UNKNOWN']);

function vehicleTimeline(vehicle, scenario, elapsedSeconds) {
  const localElapsed = elapsedSeconds - Number(vehicle.startOffsetSeconds || 0);
  if (localElapsed < 0) return Object.freeze({ tripState: 'NOT_STARTED', progress: 0, cycleSecond: 0 });
  if (!scenario.loop && localElapsed >= scenario.durationSeconds) {
    return Object.freeze({ tripState: 'COMPLETED', progress: 1, cycleSecond: scenario.durationSeconds });
  }
  const cycleSecond = scenario.loop ? localElapsed % scenario.durationSeconds : localElapsed;
  return Object.freeze({ tripState: 'ACTIVE', progress: cycleSecond / scenario.durationSeconds, cycleSecond });
}

function occupancyAt(profile, second) {
  const entry = (Array.isArray(profile) ? profile : []).find((item) => (
    Number(item.fromSecond) <= second && second < Number(item.toSecond)
  ));
  return OCCUPANCY.has(entry?.status) ? entry.status : 'UNKNOWN';
}

function simulateScenarioSnapshot({
  scenario: suppliedScenario,
  scenarioId,
  now = new Date(),
  startedAt = now,
  elapsedSeconds: explicitElapsedSeconds,
  freshnessConfig = {},
} = {}) {
  const scenario = suppliedScenario ? validateScenario(suppliedScenario) : loadScenario(scenarioId);
  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error('INVALID_SIMULATION_CLOCK');
  const elapsedSeconds = elapsedSimulationSeconds({ now: current, startedAt, explicitElapsedSeconds });
  const vehicles = scenario.vehicles.map((vehicle) => {
    const timeline = vehicleTimeline(vehicle, scenario, elapsedSeconds);
    const [lng, lat] = interpolateLineString(scenario.routeGeometry.coordinates, timeline.progress);
    const observedAt = new Date(current.getTime() - Number(vehicle.observationLagSeconds || 0) * 1000).toISOString();
    const dataFreshness = evaluateLocationFreshness({ recorded_at: observedAt }, { now: current, config: freshnessConfig });
    return Object.freeze({
      id: vehicle.vehicleId,
      label: vehicle.label,
      transportMode: vehicle.transportMode,
      routeVariantId: scenario.routeVariantId,
      lat,
      lng,
      observedAt,
      occupancy: occupancyAt(vehicle.occupancyProfile, timeline.cycleSecond),
      tripState: timeline.tripState,
      progress: Number(timeline.progress.toFixed(6)),
      dataFreshness,
      dataMode: 'SIMULATED',
      simulation: true,
    });
  });
  const active = vehicles.filter((vehicle) => vehicle.tripState === 'ACTIVE');
  return Object.freeze({
    scenario: Object.freeze({
      scenarioId: scenario.scenarioId,
      name: scenario.name,
      notice: scenario.notice,
      dataMode: 'SIMULATED',
      loop: scenario.loop,
      durationSeconds: scenario.durationSeconds,
      routeGeometry: scenario.routeGeometry,
    }),
    elapsedSeconds,
    generatedAt: current.toISOString(),
    dataMode: 'SIMULATED',
    simulation: true,
    activeVehicleCount: active.length,
    freshActiveVehicleCount: active.filter((vehicle) => vehicle.dataFreshness.status === FRESHNESS_STATUS.FRESH).length,
    staleVehicleCount: vehicles.filter((vehicle) => vehicle.dataFreshness.status === FRESHNESS_STATUS.STALE).length,
    vehicles: Object.freeze(vehicles),
  });
}

function toOperationalRecords(snapshot) {
  return Object.freeze(snapshot.vehicles.map((item) => {
    const variant = Object.freeze({ documentId: item.routeVariantId, variant_code: item.routeVariantId });
    const occupancyLevel = item.occupancy === 'FULL' ? 'full'
      : item.occupancy === 'NEAR_FULL' ? 'near_full'
        : item.occupancy === 'AVAILABLE' ? 'low' : null;
    const vehicle = Object.freeze({
      documentId: item.id, vehicle_status: item.tripState === 'ACTIVE' ? 'in_transit' : 'offline',
      occupancy_level: occupancyLevel, data_mode: 'SIMULATED', active_route_variant: variant,
    });
    const trip = Object.freeze({
      documentId: `trip-${item.id}`, trip_status: item.tripState === 'ACTIVE' ? 'active' : 'completed',
      is_simulated: true, data_mode: 'SIMULATED', route_variant: variant, vehicle,
    });
    return Object.freeze({
      vehicle, trip,
      location: Object.freeze({ latitude: item.lat, longitude: item.lng, recorded_at: item.observedAt, data_mode: 'SIMULATED', trip, vehicle }),
    });
  }));
}

module.exports = { occupancyAt, simulateScenarioSnapshot, toOperationalRecords, vehicleTimeline };
