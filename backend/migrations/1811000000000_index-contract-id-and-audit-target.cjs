/**
 * Index two lookups that scanned their whole table:
 *
 *  - contract_events (contract_id, ledger): yield history filters by
 *    contract_id, and reorg handling deletes `contract_id = ANY(...) AND
 *    ledger >= ...`. contract_events grows with every on-chain event.
 *  - audit_logs (target): the float transfer audit trail is read by target.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createIndex('contract_events', ['contract_id', 'ledger'], {
    name: 'idx_contract_events_contract_id_ledger',
    ifNotExists: true,
  });
  pgm.createIndex('audit_logs', ['target'], {
    name: 'idx_audit_logs_target',
    ifNotExists: true,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropIndex('audit_logs', ['target'], {
    name: 'idx_audit_logs_target',
    ifExists: true,
  });
  pgm.dropIndex('contract_events', ['contract_id', 'ledger'], {
    name: 'idx_contract_events_contract_id_ledger',
    ifExists: true,
  });
};
