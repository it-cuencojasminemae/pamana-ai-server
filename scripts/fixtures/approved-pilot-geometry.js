'use strict';

// Deliberate expectations for the recorded 2026-10-05 approved application.
// No receipt, database backup, user data, sequence state or connection settings.
// This single transport digest is necessary for existing preservation checks;
// never replace it with a value discovered from the database under test.
const EXPECTED_DIGEST = '0d24f4205ae5fd89c4e580a2e82afaaa9012bcbf94ad2455d63dfbd87c2d060a';
const DISTANCES = Object.freeze({
  'RCH-SJ-SMROB-OUT': 10694,
  'RCH-SJ-SMROB-IN': 11165,
  'PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT': 3007,
  'PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT': 7687,
});
const COUNTS = Object.freeze({
  transport_nodes: 10, routes: 8, route_variants: 4, route_variant_stops: 8,
  fare_rules: 2, service_patterns: 0, field_verified_nodes: 4,
  field_verified_routes: 3, field_verified_variants: 4, field_verified_fares: 2,
  planning_nodes: 4, planning_routes: 3, planning_variants: 4,
});

// Synthetic planning inputs with only the fields planVariant validates.
// IDs/endpoints use the deliberate product approval manifest, not raw records.
function beforeApplicationVariants() {
  return require('../data/batch-a5b-approved-geometry.json').approved.map(d => ({
    id: d.variant_id, variant_code: d.variant_code,
    route: { route_code: d.route_code, transport_mode: d.transport_mode },
    verification_status: 'FIELD_VERIFIED', data_mode: 'REAL', planning_enabled: true,
    geometry_geojson: null, geometry_source: 'UNKNOWN', encoded_polyline: null,
    notes: 'Synthetic existing transport note.',
    route_variant_stops: d.stop_ids.map((id, i) => ({
      id, sequence: i + 1, distance_from_variant_start_m: null,
      transport_node: {
        node_code: i === 0 ? d.origin_node_code : d.destination_node_code,
        longitude: (i === 0 ? d.origin_coordinates : d.destination_coordinates)[0],
        latitude: (i === 0 ? d.origin_coordinates : d.destination_coordinates)[1],
      },
    })),
  }));
}
module.exports = { EXPECTED_DIGEST, DISTANCES, COUNTS, beforeApplicationVariants };
