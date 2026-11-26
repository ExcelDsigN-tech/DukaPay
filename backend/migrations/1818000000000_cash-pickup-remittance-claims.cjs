/**
 * Issue #947: Cash pickup — `remittance_claims` table, `delivery_method` on
 * `remittances`, and RLS policies.
 *
 * Money columns (`amount_stroops`) follow the same convention as
 * `1802000000000_money_stroops_integer.cjs` and `1812000000000_create-agent-vaults.cjs`:
 * `NUMERIC(38, 0)` with an explicit integer-stroop CHECK constraint.
 *
 * RLS mirrors `1808000000000_enable-rls.cjs`:
 * - admin: full access (`dukapay_request_is_admin()`)
 * - recipient / agent: read their own rows (`dukapay_request_wallet()`)
 * - auditor: read-only across all rows (`dukapay_request_is_auditor()`)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE remittances
      ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'wallet'
        CONSTRAINT remittances_delivery_method_check CHECK (delivery_method IN ('wallet', 'cash_pickup')),
      ADD COLUMN IF NOT EXISTS agent_address TEXT,
      ADD COLUMN IF NOT EXISTS recipient_region TEXT;

    CREATE INDEX IF NOT EXISTS idx_remittances_delivery_method
      ON remittances (delivery_method);

    CREATE INDEX IF NOT EXISTS idx_remittances_agent_address
      ON remittances (agent_address)
      WHERE agent_address IS NOT NULL;
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS remittance_claims (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      remittance_id UUID NOT NULL UNIQUE REFERENCES remittances(id) ON DELETE CASCADE,
      recipient_address TEXT NOT NULL,
      agent_address TEXT NOT NULL,
      amount_stroops NUMERIC(38, 0) NOT NULL
        CONSTRAINT remittance_claims_amount_is_stroops CHECK (
          amount_stroops = trunc(amount_stroops) AND amount_stroops > 0
        ),
      status TEXT NOT NULL DEFAULT 'pending_mint'
        CONSTRAINT remittance_claims_status_check CHECK (
          status IN ('pending_mint', 'credited', 'redeemed', 'failed')
        ),
      redeem_code TEXT,
      mint_tx_hash TEXT,
      burn_tx_hash TEXT,
      mint_attempts INTEGER NOT NULL DEFAULT 0,
      mint_error TEXT,
      last_mint_attempt_at TIMESTAMP WITH TIME ZONE,
      credited_at TIMESTAMP WITH TIME ZONE,
      redeemed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_remittance_claims_recipient
      ON remittance_claims (recipient_address, status);

    CREATE INDEX IF NOT EXISTS idx_remittance_claims_agent
      ON remittance_claims (agent_address, status);

    CREATE INDEX IF NOT EXISTS idx_remittance_claims_pending_mint
      ON remittance_claims (status, last_mint_attempt_at)
      WHERE status = 'pending_mint';
  `);

  pgm.sql(`
    ALTER TABLE remittance_claims ENABLE ROW LEVEL SECURITY;

    CREATE POLICY remittance_claims_rls_admin ON remittance_claims
      FOR ALL USING (public.dukapay_request_is_admin())
      WITH CHECK (public.dukapay_request_is_admin());

    CREATE POLICY remittance_claims_rls_own_read ON remittance_claims
      FOR SELECT USING (
        recipient_address = public.dukapay_request_wallet()
        OR agent_address = public.dukapay_request_wallet()
      );

    CREATE POLICY remittance_claims_rls_auditor_read ON remittance_claims
      FOR SELECT USING (public.dukapay_request_is_auditor());
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS remittance_claims_rls_auditor_read ON remittance_claims;
    DROP POLICY IF EXISTS remittance_claims_rls_own_read ON remittance_claims;
    DROP POLICY IF EXISTS remittance_claims_rls_admin ON remittance_claims;
    DROP TABLE IF EXISTS remittance_claims;

    DROP INDEX IF EXISTS idx_remittances_agent_address;
    DROP INDEX IF EXISTS idx_remittances_delivery_method;

    ALTER TABLE remittances
      DROP CONSTRAINT IF EXISTS remittances_delivery_method_check,
      DROP COLUMN IF EXISTS recipient_region,
      DROP COLUMN IF EXISTS agent_address,
      DROP COLUMN IF EXISTS delivery_method;
  `);
};
