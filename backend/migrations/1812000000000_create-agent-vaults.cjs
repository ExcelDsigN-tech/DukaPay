/**
 * Issue #774: create the `agent_vaults` table that `poolController.
 * getAgentDashboard` and the reconciliation job's agent pass already read
 * from, and which the event indexer will now populate from the nine
 * agent_registry / agent_vault contract events.
 *
 * Money columns (bond_amount, float_balance, collateral_balance) follow the
 * same convention as 1802000000000_money_stroops_integer.cjs: NUMERIC(38,0)
 * with an explicit integer-stroop CHECK constraint.
 *
 * Earlier migrations (1807000000000_perf-indexes.cjs,
 * 1808000000000_enable-rls.cjs) already anticipate this table behind
 * `to_regclass(...) IS NOT NULL` guards, but on a fresh database those
 * migrations run BEFORE this one and so skip it — this migration creates
 * its own indexes and RLS policies rather than relying on them to pick it
 * up retroactively.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS agent_vaults (
      agent_address TEXT PRIMARY KEY,

      -- Registry state (agent_registry contract)
      status TEXT NOT NULL DEFAULT 'Pending',
      bond_amount NUMERIC(38, 0) NOT NULL DEFAULT 0
        CONSTRAINT agent_vaults_bond_amount_is_stroops CHECK (bond_amount = trunc(bond_amount)),
      region TEXT,
      license_expiry BIGINT,

      -- Vault state (agent_vault contract)
      float_balance NUMERIC(38, 0) NOT NULL DEFAULT 0
        CONSTRAINT agent_vaults_float_balance_is_stroops CHECK (float_balance = trunc(float_balance)),
      collateral_balance NUMERIC(38, 0) NOT NULL DEFAULT 0
        CONSTRAINT agent_vaults_collateral_balance_is_stroops CHECK (collateral_balance = trunc(collateral_balance)),

      -- Derived from status = 'Active'; kept as its own column because
      -- poolController/reconciliation filter and read it directly.
      is_active BOOLEAN NOT NULL DEFAULT false,

      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_agent_vaults_agent ON agent_vaults (agent_address);
    CREATE INDEX IF NOT EXISTS idx_agent_vaults_active ON agent_vaults (is_active) WHERE is_active = true;
  `);

  // RLS: same shape as the owner-bearing tables in 1808000000000_enable-rls.cjs
  // (agent_address owner, no agent-view, no own-all), reproduced here because
  // that migration's guard already ran and skipped this table on a fresh DB.
  pgm.sql(`
    ALTER TABLE agent_vaults ENABLE ROW LEVEL SECURITY;

    CREATE POLICY agent_vaults_rls_admin ON agent_vaults
      FOR ALL USING (public.dukapay_request_is_admin())
      WITH CHECK (public.dukapay_request_is_admin());

    CREATE POLICY agent_vaults_rls_own ON agent_vaults
      FOR SELECT USING (agent_address = public.dukapay_request_wallet());

    CREATE POLICY agent_vaults_rls_lender_own ON agent_vaults
      FOR SELECT USING (
        public.dukapay_request_is_lender()
        AND agent_address = public.dukapay_request_wallet()
      );
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS agent_vaults');
};
