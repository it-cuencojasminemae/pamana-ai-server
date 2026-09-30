'use strict';

/** Strapi 5 registration returns a refresh token in JSON even in HttpOnly mode.
 * Honor the existing server session policy just as login/refresh already do. */
module.exports = (plugin) => {
  const original = plugin.controllers.auth;
  const wrap = (controller) => ({
    ...controller,
    async register(ctx, ...args) {
      const result = await controller.register.call(this, ctx, ...args);
      const mode = strapi.config.get('plugin::users-permissions.jwtManagement');
      const sessions = strapi.config.get('plugin::users-permissions.sessions') || {};
      if (mode === 'refresh' && sessions.httpOnly && typeof ctx.body?.refreshToken === 'string') {
        const cookie = sessions.cookie || {};
        ctx.cookies.set(cookie.name || 'strapi_up_refresh', ctx.body.refreshToken, {
          httpOnly: true, secure: cookie.secure ?? process.env.NODE_ENV === 'production',
          sameSite: cookie.sameSite ?? 'lax', path: cookie.path ?? '/',
          domain: cookie.domain, maxAge: cookie.maxAge, overwrite: true,
        });
        const { refreshToken, ...body } = ctx.body;
        ctx.body = body;
      }
      return result;
    },
  });
  plugin.controllers.auth = typeof original === 'function' ? (...args) => wrap(original(...args)) : wrap(original);
  return plugin;
};
