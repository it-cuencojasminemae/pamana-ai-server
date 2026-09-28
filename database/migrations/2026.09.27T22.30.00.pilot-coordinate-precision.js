'use strict';

/**
 * Transport-node coordinates need enough scale for verified boarding and
 * alighting points. Strapi's default decimal(10,2) rounds them by kilometres.
 */
module.exports = {
  async up(knex) {
    await knex.raw(`
      alter table transport_nodes
        alter column latitude type numeric(20, 15) using latitude::numeric(20, 15),
        alter column longitude type numeric(20, 15) using longitude::numeric(20, 15)
    `);
  },
};
