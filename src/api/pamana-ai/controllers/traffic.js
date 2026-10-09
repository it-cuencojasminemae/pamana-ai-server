'use strict';
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { consumeRateLimit } = require('../../../services/security/request-guard');
const { createTrafficProvider, validTrafficTile } = require('../../../services/pamana-journey/traffic-tiles');
function createTrafficHandlers(provider = createTrafficProvider()) {
  const allowed = ctx => enforceRole(ctx, [ROLE.PASSENGER, ROLE.LGU, ROLE.ADMINISTRATOR]);
  return {
    find(ctx) {
      if (!allowed(ctx)) return;
      ctx.set?.('Cache-Control', 'no-store');
      ctx.body = { configured: provider.configured(), source: 'TOMTOM', refreshSeconds: 60 };
    },
    async tile(ctx) {
      if (!allowed(ctx) || !consumeRateLimit(ctx, 'traffic-tiles', { limit: 180, windowMs: 60000 })) return;
      ctx.set?.('Cache-Control', 'no-store');
      const { z, x, y } = ctx.params || {};
      if (!validTrafficTile(z, x, y)) { ctx.status = 400; ctx.body = { status: 'INVALID_TILE' }; return; }
      const data = await provider.tile(z, x, y);
      if (!data) { ctx.status = 503; ctx.body = { status: 'TRAFFIC_UNAVAILABLE' }; return; }
      ctx.type = 'image/png'; ctx.body = data;
    },
  };
}
module.exports = { ...createTrafficHandlers(), createTrafficHandlers };
