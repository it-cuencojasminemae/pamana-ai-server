'use strict';

function operationalRecord(variant, {
  code = 'A',
  recordedAt = '2026-09-28T07:59:30+08:00',
  occupancyLevel = 'low',
  vehicleStatus = 'in_transit',
  dataMode = 'REAL',
  isSimulated = false,
  includeLocation = true,
  tripStatus = 'active',
  assignedVariant = variant,
  tripVariant = variant,
} = {}) {
  const vehicle = {
    id: `vehicle-${code}`,
    documentId: `vehicle-${code}`,
    vehicle_status: vehicleStatus,
    occupancy_level: occupancyLevel,
    current_occupancy: occupancyLevel == null ? 0 : 5,
    data_mode: dataMode,
    active_route_variant: assignedVariant,
  };
  const trip = {
    id: `trip-${code}`,
    documentId: `trip-${code}`,
    trip_status: tripStatus,
    is_simulated: isSimulated,
    data_mode: dataMode,
    route_variant: tripVariant,
    availability_status: vehicleStatus === 'full' || occupancyLevel === 'full' ? 'FULL'
      : occupancyLevel === 'near_full' ? 'LIMITED' : ['empty', 'low', 'moderate'].includes(occupancyLevel) ? 'AVAILABLE' : 'UNKNOWN',
    availability_source: dataMode === 'REAL' ? 'DRIVER' : 'SIMULATION',
    availability_reported_at: recordedAt,
    vehicle,
  };
  return {
    vehicle,
    trip,
    location: includeLocation ? {
      id: `location-${code}`,
      documentId: `location-${code}`,
      latitude: 15,
      longitude: 120.7,
      recorded_at: recordedAt,
      data_mode: dataMode,
      trip,
      vehicle,
    } : null,
  };
}

module.exports = { operationalRecord };
