/**
 * Index transaction hashes used to reconcile on-chain float transfers.
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createIndex('agent_float_transfers', 'tx_hash', {
    name: 'agent_float_transfers_tx_hash_idx',
    where: 'tx_hash IS NOT NULL',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('agent_float_transfers', 'tx_hash', {
    name: 'agent_float_transfers_tx_hash_idx',
    where: 'tx_hash IS NOT NULL',
  });
};
