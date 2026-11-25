/**
 * Persist agent applications until registration is signed and indexed.
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE agent_applications (
      id BIGSERIAL PRIMARY KEY,
      agent_public_key VARCHAR(56) NOT NULL UNIQUE,
      kyc_ref_encrypted TEXT NOT NULL,
      region VARCHAR(16) NOT NULL,
      bond_stroops NUMERIC NOT NULL CHECK (bond_stroops > 0),
      license_expiry BIGINT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'AWAITING_SIGNATURE', 'REGISTERED', 'REJECTED')),
      registration_xdr TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX agent_applications_status_created_idx
      ON agent_applications (status, created_at);
    ALTER TABLE agent_applications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY agent_applications_admin ON agent_applications
      FOR ALL USING (public.dukapay_request_is_admin())
      WITH CHECK (public.dukapay_request_is_admin());
    CREATE POLICY agent_applications_own_select ON agent_applications
      FOR SELECT USING (agent_public_key = public.dukapay_request_wallet());
    CREATE POLICY agent_applications_own_insert ON agent_applications
      FOR INSERT WITH CHECK (agent_public_key = public.dukapay_request_wallet());
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS agent_applications');
};
