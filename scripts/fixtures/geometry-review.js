'use strict';

// Minimal review contract from deliberate, hash-checked assets, without DB evidence.
const { loadCandidateArtifacts } = require('../apply-batch-a5b-approved-geometry');
const { beforeApplicationVariants } = require('./approved-pilot-geometry');
const { requestParameters, farePreview, multiLegPreview } = require('../generate-batch-a5-candidates');
function reviewContract() {
  const inputs = beforeApplicationVariants().map(v => ({
    ...v, stops: v.route_variant_stops.map(s => s.transport_node),
  }));
  const variants = loadCandidateArtifacts().map(({ properties: p }, i) => ({
    ...p, origin: inputs[i].stops[0], destination: inputs[i].stops[1],
    candidate_distance_m: p.provider_reported_distance_m,
    candidate_distance_km: p.provider_reported_distance_m / 1000,
    candidate_duration_s: p.provider_reported_duration_s,
    geojson_filename: `${p.variant_code}.candidate.geojson`,
    request_parameters: requestParameters(inputs[i]),
    fare_preview: i === 3 ? { fare_php: 100, status: 'DEMO_ESTIMATE', distance_used_for_fare: false }
      : farePreview(p.provider_reported_distance_m),
  }));
  return { variants, inputs, multi_leg_journey: multiLegPreview(variants[2]),
    direct_journey: { transfers: 0 }, return_journey: { transfers: 0 } };
}
module.exports = { reviewContract };
