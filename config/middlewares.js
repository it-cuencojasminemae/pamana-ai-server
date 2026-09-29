module.exports = ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      origin: env.array('CORS_ORIGINS', ['http://localhost:3000', 'http://127.0.0.1:3000']),
      credentials: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      jsonLimit: '256kb',
      formLimit: '256kb',
      textLimit: '256kb',
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
