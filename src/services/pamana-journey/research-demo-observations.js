'use strict';

// Synthetic observations are a separate optional layer. They never change the
// local-research service/geometry provenance or enter the transport database.
function demoObservations(journeys, observedAt, context) {
  if (!context?.researchPreview || !context.allowSimulatedObservations) return { servicePatterns: [], operationalRecords: [] };
  const legs = [...new Map(journeys.flatMap(j => j.legs.filter(l => l.type === 'TRANSIT')).map(l => [l.routeVariantId, l])).values()];
  const stamp = new Date(observedAt).toISOString();
  const servicePatterns = legs.map(leg => ({ documentId: `preview-observation-${leg.routeVariantId}`, route_variant: { documentId: leg.routeVariantId, variant_code: leg.variantCode },
    simulation_validated_at: stamp, planning_enabled: true, verification_status: 'SIMULATED_DEMO', data_mode: 'SIMULATED',
    source_name: 'SIMULATED preview service observation', source_reference: 'Deterministic demonstration scenario, not field observations',
    days_of_week: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], first_trip_time: '00:00:00', last_trip_time: '23:59:59',
    dispatch_type: 'HEADWAY', headway_min_minutes: leg.variantCode.includes('ARAYAT') ? 8 : 4,
    headway_max_minutes: leg.variantCode.includes('ARAYAT') ? 15 : 8 }));
  const operationalRecords = legs.filter(leg => !leg.variantCode.includes('ARAYAT')).map(leg => ({
    vehicle: { documentId: `preview-vehicle-${leg.routeVariantId}`, active_route_variant: { documentId: leg.routeVariantId },
      vehicle_status: 'available', occupancy_level: 'low', data_mode: 'SIMULATED' },
    location: { data_mode: 'SIMULATED', recorded_at: stamp, latitude: leg.boardAt.lat, longitude: leg.boardAt.lng },
  }));
  return { servicePatterns, operationalRecords };
}

function simulatedRideDuration(leg, context) {
  if (!context?.researchPreview || !context.allowSimulatedObservations || leg.type !== 'TRANSIT' || !Number.isFinite(leg.segmentDistanceMeters)) return null;
  // Explicit scenario speed, not an ETA model or a measured jeepney speed.
  return Math.ceil(leg.segmentDistanceMeters / 5);
}

module.exports = { demoObservations, simulatedRideDuration };
