'use strict';
const { getLandmarks } = require('../../../services/pamana-journey/pilot-landmarks');
const { ROLE, enforceRole } = require('../../../services/security/access-control');
module.exports = { find(ctx) {
  if (!enforceRole(ctx, [ROLE.PASSENGER, ROLE.LGU, ROLE.ADMINISTRATOR])) return;
  ctx.set?.('Cache-Control', 'no-store');
  ctx.body = getLandmarks();
} };
