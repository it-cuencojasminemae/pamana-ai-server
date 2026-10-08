'use strict';

const { getPinArea } = require('../../../services/pamana-journey/pin-area');
const { ROLE, enforceRole } = require('../../../services/security/access-control');

module.exports = {
  find(ctx) {
    if (!enforceRole(ctx, [ROLE.PASSENGER, ROLE.LGU, ROLE.ADMINISTRATOR])) return;
    ctx.set?.('Cache-Control', 'no-store');
    ctx.body = getPinArea();
  },
};
