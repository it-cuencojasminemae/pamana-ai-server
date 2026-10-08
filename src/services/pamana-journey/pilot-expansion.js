'use strict';
const manifest = require('../../../scripts/data/san-fernando-expansion.json');
// This registry is deliberately independent of file edits and the feature flag.
const VARIANT_CODES = Object.freeze(['CSF-MEXICO-SFELAPCO-OUT', 'CSF-MEXICO-MARKET-OUT', 'CSF-SM-PALENGKE-OUT']);
const PREVIEW_ONLY_CODES = Object.freeze(['RCH-SJ-MEXICO-OUT', 'CSF-CITY-ROB-IN', 'CSF-ARAYAT-ROB-IN', 'RCH-SAN-JUAN-INITIAL-FEEDER']);
const evidence = value => Boolean(value && typeof value.sourceReference === 'string' && value.sourceReference.trim()
  && typeof value.reviewedBy === 'string' && value.reviewedBy.trim() && Number.isFinite(Date.parse(value.verifiedAt)));
function validateReviewedManifest(value) {
  const errors = [];
  if (value?.version !== '1.0.0' || value?.id !== 'CSF-OUTBOUND-2026-10-07' || value?.status !== 'VERIFIED' || !evidence(value?.review)) errors.push('Manifest requires a completed verification review.');
  const nodes = new Map((value?.nodes || []).map(n => [n.node_code, n]));
  if (nodes.size !== value?.nodes?.length) errors.push('Duplicate nodes.');
  for (const node of nodes.values()) {
    if (!node.node_code?.startsWith('CSF-') || !Number.isFinite(node.latitude) || !Number.isFinite(node.longitude)
      || Math.abs(node.latitude) > 90 || Math.abs(node.longitude) > 180 || !evidence(node.verification)) errors.push(`Unverified passenger point: ${node.node_code}`);
  }
  const variants = value?.variants || [];
  if (value?.routes?.length !== 1 || value.routes[0].route_code !== 'CSF-SM-PALENGKE' || value.routes[0].transport_mode !== 'PUJ_TRADITIONAL') errors.push('Only the outbound SM Palengke parent route may be added.');
  if (variants.length !== VARIANT_CODES.length || new Set(variants.map(v => v.variant_code)).size !== VARIANT_CODES.length) errors.push('All three distinct service patterns are required.');
  for (const variant of variants) {
    const g = variant.geometry_geojson;
    if (!VARIANT_CODES.includes(variant.variant_code) || variant.direction !== 'OUTBOUND'
      || !['FIELD_GPS', 'AUTHORITATIVE', 'MANUAL_VERIFIED'].includes(variant.geometry_source)
      || !evidence(variant.corridorVerification) || variant.corridorVerification?.stopOrderConfirmed !== true || variant.corridorVerification?.serviceTerminusConfirmed !== true || variant.corridorVerification?.jeepCorridorConfirmed !== true
      || g?.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2
      || !g.coordinates.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)
      || !Array.isArray(variant.stops) || variant.stops.length < 2 || new Set(variant.stops).size !== variant.stops.length
      || variant.stops.some(code => !nodes.has(code) && code !== 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER')) errors.push(`Unverified corridor/stops: ${variant.variant_code}`);
    const sm = variant.variant_code === 'CSF-SM-PALENGKE-OUT';
    const expectedEnd = sm ? 'CSF-PALENGKE-ALIGHT' : variant.variant_code === 'CSF-MEXICO-MARKET-OUT' ? 'CSF-MARKET-ALIGHT' : 'CSF-SFELAPCO-ALIGHT';
    if (variant.route_code !== (sm ? 'CSF-SM-PALENGKE' : 'RCH-ARAYAT-SF-VIA-STAANA-MEXICO') || variant.stops?.[0] !== (sm ? 'CSF-SM-TERMINAL-BOARD' : 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER') || variant.stops?.at(-1) !== expectedEnd) errors.push(`Service endpoints changed: ${variant.variant_code}`);
  }
  const links = value?.connections || [];
  if (links.length !== 1 || links[0].id !== 'CSF-SM-DROPOFF-TO-TERMINAL' || links[0].fromNodeCode !== 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'
    || links[0].toNodeCode !== 'CSF-SM-TERMINAL-BOARD' || links[0].status !== 'VERIFIED' || !evidence(links[0].verification) || links[0].verification.pedestrianConnectionConfirmed !== true) errors.push('SM pedestrian connection is not verified.');
  const changes = value?.transferPermissionChanges;
  const expectedChanges = manifest.transferPermissionChanges;
  if (!Array.isArray(changes) || changes.length !== 2 || changes.some((c, index) => JSON.stringify(c) !== JSON.stringify(expectedChanges[index]))) errors.push('Only the two reviewed SM transfer permissions may change.');
  return errors;
}
function expansionSettings({ enabled = process.env.PAMANA_CSF_ROUTE_EXPANSION_ENABLED === 'true', data = manifest } = {}) {
  const verified = validateReviewedManifest(data).length === 0;
  return { enabled: Boolean(enabled && verified), verified, connections: enabled && verified ? data.connections : [],
    maxTransfers: enabled && verified ? 2 : 1 };
}
function filterExpansionGraphData(graphData, settings = expansionSettings()) {
  return { ...graphData, variants: (graphData?.variants || []).filter(v => !PREVIEW_ONLY_CODES.includes(v.variant_code)
    && (settings.enabled || !VARIANT_CODES.includes(v.variant_code))) };
}
function boardingGuidance(code) {
  const variant = manifest.variants.find(v => v.variant_code === code);
  if (!variant || !VARIANT_CODES.includes(code)) return {};
  return { signboardAliases: [...variant.signboardAliases], boardingInstructions: [
    `Check the signboard: ${variant.signboardAliases.join(', ')}.`,
    `Before boarding, ask the driver whether the jeep passes your intended landmark and confirm the final drop-off (${variant.display_name.includes('SFELAPCO') ? 'SFELAPCO' : code === 'CSF-MEXICO-MARKET-OUT' ? 'market-side City Proper' : 'Palengke / SM Downtown'}).`,
  ] };
}
module.exports = { VARIANT_CODES, validateReviewedManifest, expansionSettings, filterExpansionGraphData, boardingGuidance };
