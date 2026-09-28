'use strict';

module.exports = {
  routes: [
    { method: 'GET', path: '/transport-workbench/:entity', handler: 'transport-workbench.list', config: { policies: [] } },
    { method: 'GET', path: '/transport-workbench/:entity/:documentId', handler: 'transport-workbench.detail', config: { policies: [] } },
    { method: 'POST', path: '/transport-workbench/:entity', handler: 'transport-workbench.create', config: { policies: [] } },
    { method: 'PUT', path: '/transport-workbench/:entity/:documentId', handler: 'transport-workbench.update', config: { policies: [] } },
  ],
};
