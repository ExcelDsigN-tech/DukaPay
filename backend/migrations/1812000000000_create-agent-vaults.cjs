/**
 * Create the indexed agent-vault ledger used by the public solvency view and
 * reconciliation job.
 *
 * The Soroban contract remains the source of truth. This table is a durable
 * projection so reads do not need to simulate every vault on every request.
 */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable('agent_vaults', {
    agent_address: { type: 'varchar(255)', primaryKey: true },
    float_balance: { type: 'numeric(38,0)', notNull: true, default: 0 },
    collateral_balance: { type: 'numeric(38,0)', notNull: true, default: 0 },
    haircut_bps: { type: 'integer', notNull: true, default: 10_000 },
    is_active: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.addConstraint('agent_vaults', 'agent_vaults_haircut_bps_check', {
    check: 'haircut_bps > 0 AND haircut_bps <= 10000',
  });
  pgm.createIndex('agent_vaults', 'is_active', {
    name: 'idx_agent_vaults_active',
    where: 'is_active = true',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('agent_vaults');
};
