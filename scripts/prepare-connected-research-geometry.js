'use strict';

// Provider geometry is research material, never operational transport evidence.
// No database writes. --apply records a receipt; --review is a separate map review.
const fs = require('node:fs');
const path = require('node:path');
const { segmentLength } = require('../src/services/pamana-journey/route-distance');
const { projectPoint } = require('../src/services/pamana-journey/corridor-connectors');
const file = path.join(__dirname, '../src/services/pamana-journey/data/connected-research-manifest.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(manifest.nodes.map(n => [n.node_code, n]));
const apply = process.argv.includes('--apply');
const review = process.argv.includes('--review');
const summary = [];

async function route(variant) {
  const stopPoints = variant.stops.map(code => nodes.get(code)).map(n => [n.latitude, n.longitude]);
  // Building references must not force a vehicle through hospital parking lots
  // or shopping driveways. Only reported roadside stops constrain this trace.
  const middle = variant.direction === 'OUTBOUND' && stopPoints.length > 2
    ? stopPoints.slice(1, -1) : [];
  const points = [stopPoints[0], ...middle, stopPoints.at(-1)];
  const url = new URL('https://api.geoapify.com/v1/routing');
  url.searchParams.set('apiKey', process.env.GEOAPIFY_SERVER_API_KEY || '');
  url.searchParams.set('waypoints', points.map(p => p.join(',')).join('|'));
  url.searchParams.set('mode', 'drive');
  url.searchParams.set('avoid', 'tolls');
  url.searchParams.set('intermediate_waypoint_mode', 'through_stop');
  url.searchParams.set('format', 'geojson');
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
  const data = await response.json();
  const feature = data.features?.[0];
  const parts = feature?.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [feature?.geometry?.coordinates];
  if (!parts.every(part => Array.isArray(part) && part.length >= 2)) throw new Error('INVALID_GEOMETRY');
  const line = [];
  for (const part of parts) {
    if (line.length && segmentLength(line.at(-1), part[0]) > 1) throw new Error('DISCONNECTED_GEOMETRY');
    line.push(...(line.length ? part.slice(1) : part));
  }
  const roads = [...new Set((feature.properties?.legs || []).flatMap(leg => (leg.steps || []).flatMap(step => [step.name, step.instruction?.text]).filter(Boolean)))];
  return { line, distance: feature.properties.distance, roads, calculatedAt: new Date().toISOString() };
}

(async () => {
  if (review) {
    if (!manifest.variants.every(v => v.geometry_geojson)) throw new Error('GEOMETRY_MISSING');
    manifest.mapReview = { status: 'REVIEWED_RESEARCH', reviewedAt: new Date().toISOString(), reviewer: 'Codex road-name / coordinate map review',
      scope: 'Software review of provider geometry against supplied roads and reference coordinates; NOT field, pedestrian safety, or official transport verification.' };
    manifest.sections = manifest.sections.map(section => ({ ...section, reviewed: true, mapReviewedAt: manifest.mapReview.reviewedAt }));
    const returnService = manifest.variants.find(v => v.variant_code === 'CSF-CITY-ROB-IN');
    returnService.reportedSignboards = ['SM Pampanga', 'Robinsons'];
    returnService.signboardAliases = ['Robinsons'];
    returnService.serviceNote = 'Robinsons endpoint represented. Separate SM-ending return loading/drop-off arrangement remains unresolved.';
    manifest.variants.find(v => v.variant_code === 'CSF-ARAYAT-ROB-IN').originBoardingAllowed = false;
    if (apply) fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ applied: apply, mapReview: manifest.mapReview }));
    return;
  }
  if (!process.env.GEOAPIFY_SERVER_API_KEY) throw new Error('PROVIDER_NOT_CONFIGURED');
  for (const variant of manifest.variants) {
    try {
      const result = await route(variant);
      variant.geometry_geojson = { type: 'LineString', coordinates: result.line };
      variant.geometry_source = 'RESEARCH_PREVIEW';
      variant.geometryEvidence = { source: 'GEOAPIFY_FROM_RESEARCH_WAYPOINTS', calculatedAt: result.calculatedAt, roads: result.roads,
        fieldVerified: false, formalTerminusConfirmed: false };
      if (variant.corridorPermissions) {
        const total = result.line.slice(1).reduce((sum, p, i) => sum + segmentLength(result.line[i], p), 0);
        const startRef = variant.boardingStartReference || (variant.direction === 'INBOUND' ? [15.033465074114613, 120.6871634517035] : [15.044243853175653, 120.68580170088299]);
        const start = projectPoint(result.line, { lat: startRef[0], lng: startRef[1] });
        const endRef = variant.direction === 'INBOUND' ? [15.047620574015921, 120.69090540535781] : [15.030377901384702, 120.6883114052988];
        const end = projectPoint(result.line, { lat: endRef[0], lng: endRef[1] });
        if (start && end && start.offsetMeters < end.offsetMeters) {
          const id = `${variant.variant_code}-RESEARCH-SECTION`;
          manifest.sections = manifest.sections.filter(s => s.id !== id);
          manifest.sections.push({ id, variantCode: variant.variant_code, direction: variant.direction, permission: variant.corridorPermissions,
            fromMeters: Math.max(0, start.offsetMeters - 25), toMeters: Math.min(total, end.offsetMeters + 25),
            reviewed: false, evidenceClass: 'LOCAL_RESEARCH', placementSource: 'PROVIDER_DERIVED_RESEARCH',
            sourceReference: manifest.sourceReference, fieldBoardingSideVerified: false });
        }
      }
      summary.push({ variantCode: variant.variant_code, status: 'GENERATED_RESEARCH', distance: result.distance, pointCount: result.line.length, roads: result.roads });
    } catch (error) { summary.push({ variantCode: variant.variant_code, status: 'PENDING', reason: error.message }); }
  }
  if (apply) {
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(__dirname, '../documentation/connected-research-geometry-receipt.json'), JSON.stringify({ appliedAt: new Date().toISOString(), databaseWrites: 0, summary }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: apply, summary }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
