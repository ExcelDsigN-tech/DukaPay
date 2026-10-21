/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Issue #830: Drop redundant objects from agent_vaults table.
 *
 * - idx_agent_vaults_agent indexes agent_address, which is already the primary key.
 * - agent_vaults_rls_lender_own allows a subset of what agent_vaults_rls_own already allows.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.up = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_agent_vaults_agent;
    DROP POLICY IF EXISTS agent_vaults_rls_lender_own ON agent_vaults;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('public.agent_vaults') IS NOT NULL THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_agent_vaults_agent ON agent_vaults (agent_address)');
      END IF;
      IF to_regclass('public.agent_vaults') IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'agent_vaults'
                       AND column_name = 'agent_address') THEN
        EXECUTE
          'CREATE POLICY agent_vaults_rls_lender_own '
          'ON public.agent_vaults FOR SELECT '
          'USING (public.dukapay_request_is_lender() '
          '       AND agent_address = public.dukapay_request_wallet())';
      END IF;
    END $$;
  `);
};
