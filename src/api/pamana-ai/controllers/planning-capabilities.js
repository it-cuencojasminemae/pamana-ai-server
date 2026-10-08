'use strict';
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { researchPreviewEnabled, accessPolicy } = require('../../../services/pamana-journey/planning-context');
const { manifest } = require('../../../services/pamana-journey/research-transport');

module.exports = { find(ctx) {
  if (!enforceRole(ctx, [ROLE.PASSENGER, ROLE.LGU, ROLE.ADMINISTRATOR])) return;
  ctx.set?.('Cache-Control', 'no-store');
  ctx.body = { operational: true, researchPreview: researchPreviewEnabled(), accessPolicy: accessPolicy(),
    simulatedObservations: researchPreviewEnabled() && process.env.PAMANA_RESEARCH_SIMULATED_OBSERVATIONS_ENABLED === 'true',
    researchManifestVersion: manifest.version,
    referenceLocations: researchPreviewEnabled() ? manifest.nodes.map(node => ({ id: `research-reference-${node.node_code}`, name: node.name,
      lat: node.latitude, lng: node.longitude, category: 'SERVICE', nodeType: node.node_type, aliases: node.aliases || [], evidenceClass: 'USER_REPORTED' })) : [] };
} };
