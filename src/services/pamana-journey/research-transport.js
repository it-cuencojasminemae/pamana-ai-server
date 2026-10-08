'use strict';

const manifest = require('./data/connected-research-manifest.json');
const { offsetOnLine, segmentLength } = require('./route-distance');
const { RESEARCH_ID } = require('./planning-context');

function researchFields() {
  return { data_mode: 'REAL', verification_status: 'RESEARCH_CANDIDATE', planning_enabled: false, verified_at: null,
    researchEvidenceId: RESEARCH_ID, evidenceClass: 'USER_REPORTED', previewReviewed: true,
    source_name: 'User-provided local route research', source_reference: manifest.sourceReference };
}

function materializeResearchTransport(graphData, nodes, request, context) {
  const operationalSections = require('./data/reviewed-corridor-sections.json').sections;
  if (!context?.researchPreview || manifest.mapReview.status !== 'REVIEWED_RESEARCH') return { graphData, nodes, sections: operationalSections, connections: [] };
  const byCode = new Map(nodes.map(node => [node.node_code, node]));
  // Existing IDs are reused; no writes or blanket trust/permission updates.
  for (const reference of manifest.nodes) {
    const existing = byCode.get(reference.node_code);
    if (!existing) continue;
    const distance = segmentLength([Number(existing.longitude), Number(existing.latitude)], [reference.longitude, reference.latitude]);
    if (existing.node_type !== reference.node_type || !Number.isFinite(distance) || distance > 15) throw new Error('RESEARCH_NODE_IDENTITY_REVIEW_REQUIRED');
  }
  for (const reference of manifest.nodes) if (!byCode.has(reference.node_code)) {
    const near = [...byCode.values()].filter(node => node.node_type === reference.node_type && node.name === reference.name
      && Number.isFinite(node.latitude) && Number.isFinite(node.longitude)
      && segmentLength([node.longitude, node.latitude], [reference.longitude, reference.latitude]) <= 15);
    if (near.length > 1) throw new Error('AMBIGUOUS_RESEARCH_NODE_MATCH');
    byCode.set(reference.node_code, near[0] || { ...reference, ...researchFields(), documentId: `research-node-${reference.node_code}` });
  }
  const originalVariants = (graphData.variants || []).map(original => ({ ...original,
    route_variant_stops: (original.route_variant_stops || []).map(stop => manifest.transferOverlays.some(change => change.variantCode === original.variant_code && change.nodeCode === stop.transport_node.node_code)
      ? { ...stop, transfer_allowed: true, transferEvidenceClass: 'USER_REPORTED' } : stop) }));
  const routes = new Map(originalVariants.map(v => [v.route.route_code, v.route]));
  const additions = [];
  for (const specification of manifest.variants) {
    if (!specification.geometry_geojson) continue;
    const route = routes.get(specification.route_code) || { ...researchFields(), documentId: `research-route-${specification.route_code}`,
      route_code: specification.route_code, active: true, route_status: 'active', transport_mode: 'PUJ_TRADITIONAL' };
    const stops = specification.stops.map((code, index) => {
      const node = byCode.get(code);
      return { sequence: index + 1, transport_node: node,
        pickup_allowed: specification.boardingNodeCodes ? specification.boardingNodeCodes.includes(code)
          : index === 0 && specification.originBoardingAllowed !== false,
        dropoff_allowed: index > 0 && !specification.boardingNodeCodes?.includes(code),
        transfer_allowed: index === 0 || index === specification.stops.length - 1 || specification.boardingNodeCodes?.includes(code) === true,
        distance_from_variant_start_m: offsetOnLine(specification.geometry_geojson.coordinates, { lat: node.latitude, lng: node.longitude }),
      };
    });
    additions.push({ ...specification, ...researchFields(), documentId: `research-variant-${specification.variant_code}`, route,
      operating_status: 'ACTIVE', signboard_text: specification.signboardAliases[0], route_variant_stops: stops,
      boardingInstructions: [
        `Check the signboard: ${specification.signboardAliases.join(', ')}.`,
        'Before boarding, ask the driver whether this service passes your intended landmark and confirm the boarding side and final drop-off.',
        'Local research evidence; operating availability and formal termini are not field verified.',
      ] });
  }

  // Geographic pin permission cannot establish feeder service coverage.
  // Initial feeders must already exist in the eligible transport graph; unknown
  // San Juan tricycle coverage is not manufactured from a passenger coordinate.
  const addedCodes = new Set(additions.map(v => v.variant_code));
  return { graphData: { ...graphData, variants: [...originalVariants.filter(v => !addedCodes.has(v.variant_code)), ...additions] },
    nodes: [...byCode.values()], sections: [...operationalSections, ...manifest.sections], connections: manifest.connections };
}

module.exports = { materializeResearchTransport, researchFields, manifest };
