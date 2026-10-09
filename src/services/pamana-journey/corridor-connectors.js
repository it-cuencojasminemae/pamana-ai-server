'use strict';

const crypto = require('node:crypto');
const { roadLine, segmentLength, offsetOnLine } = require('./route-distance');
const { routeVariantPlanningEligibilityFor } = require('./graph-builder');

function sliceLine(line, start, end) {
  if (!Array.isArray(line) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const points = [];
  let offset = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], length = segmentLength(a, b);
    if (length && offset + length > start && offset < end) {
      const at = distance => { const t = Math.max(0, Math.min(1, (distance - offset) / length));
        return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; };
      if (!points.length) points.push(at(Math.max(offset, start)));
      points.push(at(Math.min(offset + length, end)));
    }
    offset += length;
  }
  return points.length > 1 ? { type: 'LineString', coordinates: points } : null;
}

function projectPoint(line, point, { fromMeters = 0, toMeters = Infinity } = {}) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
  const candidates = [];
  const scale = Math.cos(point.lat * Math.PI / 180);
  let offset = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], length = segmentLength(a, b);
    if (length && offset + length >= fromMeters && offset <= toMeters) {
      const dx = (b[0] - a[0]) * scale, dy = b[1] - a[1];
      const raw = (((point.lng - a[0]) * scale) * dx + (point.lat - a[1]) * dy) / (dx * dx + dy * dy);
      const low = Math.max(0, (fromMeters - offset) / length), high = Math.min(1, (toMeters - offset) / length);
      const t = Math.max(low, Math.min(high, raw));
      const coordinate = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      candidates.push({ lat: coordinate[1], lng: coordinate[0], offsetMeters: offset + t * length,
        distanceMeters: segmentLength([point.lng, point.lat], coordinate) });
    }
    offset += length;
  }
  candidates.sort((a, b) => a.distanceMeters - b.distanceMeters || a.offsetMeters - b.offsetMeters);
  const best = candidates[0];
  // A crossing/loop cannot choose between distant positions on the service.
  if (!best || candidates.some(c => c.distanceMeters <= best.distanceMeters + 1 && Math.abs(c.offsetMeters - best.offsetMeters) > 50)) return null;
  return best;
}

function sectionAllowed(section, variant, role, context) {
  const permission = role === 'ACCESS' ? 'BOARDING_ALLOWED' : 'ALIGHTING_ALLOWED';
  return section?.variantCode === variant.variant_code && section.direction === variant.direction
    && [permission, 'BOARDING_AND_ALIGHTING_ALLOWED'].includes(section.permission)
    && section.reviewed === true && typeof section.sourceReference === 'string' && section.sourceReference.trim()
    && (section.evidenceClass === 'VERIFIED_OPERATIONAL' || (context?.researchPreview && section.evidenceClass === 'LOCAL_RESEARCH'))
    && Number.isFinite(section.fromMeters) && Number.isFinite(section.toMeters) && section.fromMeters >= 0 && section.toMeters > section.fromMeters;
}

function corridorPositions(line, point, section, role) {
  const nearest = projectPoint(line, point, section);
  if (!nearest) return [];
  if (role !== 'ACCESS') return [nearest];
  // Nearby positions can be reached by different pedestrian streets. They
  // compete using provider walking distance, never projection distance alone.
  const positions = [nearest];
  for (const delta of [-100, 100]) {
    const offset = nearest.offsetMeters + delta;
    if (offset <= section.fromMeters || offset >= section.toMeters) continue;
    const segment = sliceLine(line, offset, offset + 0.01);
    if (!segment) continue;
    const [lng, lat] = segment.coordinates[0];
    positions.push({ lat, lng, offsetMeters: offset,
      distanceMeters: segmentLength([point.lng, point.lat], [lng, lat]) });
  }
  return positions.sort((a, b) => a.distanceMeters - b.distanceMeters || a.offsetMeters - b.offsetMeters);
}

// Temporary stops are inserted into the SAME ordered variant consumed by the
// existing graph builder. They are never persisted as TransportNodes.
function attachCorridorConnectors(graphData, nodes, request, { context, sections = [], serviceDate = new Date(), radiusMeters = 1500 } = {}) {
  const temporary = [];
  const variants = (graphData?.variants || []).map(original => {
    if (!routeVariantPlanningEligibilityFor(original, { context, serviceDate }).eligible) return original;
    const line = roadLine(original, { allowResearch: context?.researchPreview });
    if (!line) return original;
    const stops = [...(original.route_variant_stops || [])].sort((a, b) => a.sequence - b.sequence);
    const positioned = stops.map(stop => ({ stop, offset: offsetOnLine(line, { lat: stop.transport_node.latitude, lng: stop.transport_node.longitude }) }));
    if (positioned.some(p => p.offset === null) || positioned.some((p, i) => i && p.offset < positioned[i - 1].offset)) return original;
    const added = [];
    for (const role of ['ACCESS', 'EGRESS']) {
      const point = role === 'ACCESS' ? request.origin : request.destination;
      const matches = sections.filter(s => sectionAllowed(s, original, role, context))
        .flatMap(section => corridorPositions(line, point, section, role).map(position => ({ section, position })))
        .filter(item => item.position && item.position.distanceMeters <= radiusMeters)
        .sort((a, b) => a.position.distanceMeters - b.position.distanceMeters).slice(0, role === 'ACCESS' ? 3 : 2);
      for (const { section, position } of matches) {
        if (position.offsetMeters <= positioned[0].offset || position.offsetMeters >= positioned.at(-1).offset) continue;
        const key = crypto.createHash('sha256').update([original.variant_code, role, position.lat, position.lng, section.id].join('|')).digest('hex').slice(0, 16);
        // The +/-100m pedestrian probes are connection alternatives, not new
        // transport services. A permanent stop between probes keeps them apart.
        const interval = positioned.filter(item => item.offset < position.offsetMeters).length;
        const candidateGroupId = crypto.createHash('sha256').update([
          original.documentId || original.id || original.variant_code, original.direction,
          role, section.id, point.lat, point.lng, interval,
        ].join('|')).digest('hex').slice(0, 16);
        const node = { ...original, route_variant_stops: undefined, route: undefined, geometry_geojson: undefined,
          ...(section.evidenceClass === 'LOCAL_RESEARCH' ? {
            data_mode: 'REAL', verification_status: 'RESEARCH_CANDIDATE', planning_enabled: false, verified_at: null,
            researchEvidenceId: context.researchId, evidenceClass: 'USER_REPORTED', previewReviewed: true,
            source_name: 'User-provided roadside transport research', source_reference: section.sourceReference,
          } : {}),
          documentId: `connector-${key}`, node_code: `CONNECTOR-${key}`, name: role === 'ACCESS' ? section.pickupName || 'Roadside boarding point' : 'Roadside alighting point',
          node_type: role === 'ACCESS' ? 'ROADSIDE_PICKUP' : 'DESIGNATED_STOP', latitude: position.lat, longitude: position.lng,
          connector: { role, sectionId: section.id, candidateGroupId, evidenceClass: section.evidenceClass, placementSource: section.placementSource,
            serviceLabel: section.serviceLabel || original.signboard_text, fieldBoardingSideVerified: section.fieldBoardingSideVerified === true,
            variantCode: original.variant_code, direction: original.direction, offsetMeters: position.offsetMeters, temporary: true } };
        temporary.push(node);
        added.push({ offset: position.offsetMeters, stop: { transport_node: node, pickup_allowed: role === 'ACCESS', dropoff_allowed: role === 'EGRESS', transfer_allowed: false,
          instruction_template: role === 'ACCESS' ? section.boardingInstruction || 'Wait at a safe roadside pickup point for this service. Confirm the boarding side and exact roadside position locally.' : null } });
      }
    }
    if (!added.length) return original;
    return { ...original, route_variant_stops: [...positioned, ...added].sort((a, b) => a.offset - b.offset)
      .map((item, index) => ({ ...item.stop, sequence: index + 1, distance_from_variant_start_m: item.offset })) };
  });
  return { graphData: { ...graphData, variants }, nodes: [...nodes, ...temporary] };
}

module.exports = { attachCorridorConnectors, corridorPositions, projectPoint, sliceLine, sectionAllowed };
