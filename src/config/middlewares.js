'use strict';

// Shared generic policy also used by hosted production Strapi environments.
module.exports = ({ env }) => {
  const origins = env.array('CORS_ORIGINS', ['http://localhost:3000', 'http://127.0.0.1:3000']);
  if (origins.includes('*')) throw new Error('Credentialed CORS requires exact CORS_ORIGINS; wildcard is forbidden');
  return [
    'strapi::logger', 'strapi::errors', 'strapi::security',
    { name: 'strapi::cors', config: { origin: origins, credentials: true } },
    'strapi::poweredBy', 'strapi::query',
    { name: 'strapi::body', config: { jsonLimit: '256kb', formLimit: '256kb', textLimit: '256kb' } },
    'strapi::session', 'strapi::favicon', 'strapi::public',
  ];
};
