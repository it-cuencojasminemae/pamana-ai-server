'use strict';

/** Additive Phase 19 scalar fields. Strapi schema sync owns relation links. */
module.exports = {
  async up(knex) {
    const table = 'passenger_reports';
    const additions = [
      ['description', (t) => t.text('description')],
      ['location_accuracy_m', (t) => t.float('location_accuracy_m')],
      ['review_status', (t) => t.string('review_status').notNullable().defaultTo('PENDING')],
      ['reviewed_at', (t) => t.timestamp('reviewed_at', { useTz: true })],
      ['review_notes', (t) => t.text('review_notes')],
      ['context_source', (t) => t.string('context_source').notNullable().defaultTo('NONE')],
    ];
    for (const [column, add] of additions) {
      if (!await knex.schema.hasColumn(table, column)) {
        await knex.schema.alterTable(table, add);
      }
    }
  },
};
