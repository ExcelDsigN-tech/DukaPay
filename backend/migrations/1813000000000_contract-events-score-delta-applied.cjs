/**
 * Record the score change an event actually applied, after clamping to
 * [300, 850], so an indexer reorg rollback can reverse exactly that instead
 * of the configured delta (issue #770). NULL means the event was indexed
 * before this column existed; rollback falls back to the configured delta.
 *
 * Read only by the reorg rollback, which already filters on
 * (contract_id, ledger) via idx_contract_events_contract_id_ledger.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn('contract_events', {
    score_delta_applied: { type: 'integer' },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn('contract_events', 'score_delta_applied');
};
