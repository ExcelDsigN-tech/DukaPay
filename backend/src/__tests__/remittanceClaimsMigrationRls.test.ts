import { createRequire } from 'node:module';
import { jest } from '@jest/globals';

const require = createRequire(import.meta.url);
const migration = require('../../migrations/1818000000000_cash-pickup-remittance-claims.cjs');

describe('1818000000000_cash-pickup-remittance-claims migration & RLS (#947)', () => {
  it('applies remittance_claims, delivery_method, and RLS policies in up()', () => {
    const sqlStatements: string[] = [];
    const pgm = {
      sql: jest.fn((stmt: string) => {
        sqlStatements.push(stmt);
      }),
    };

    migration.up(pgm);

    const joined = sqlStatements.join('\n');
    expect(joined).toContain('ALTER TABLE remittances');
    expect(joined).toContain('delivery_method');
    expect(joined).toContain("CHECK (delivery_method IN ('wallet', 'cash_pickup'))");
    expect(joined).toContain('CREATE TABLE IF NOT EXISTS remittance_claims');
    expect(joined).toContain('amount_stroops NUMERIC(38, 0)');
    expect(joined).toContain("status IN ('pending_mint', 'credited', 'redeemed', 'failed')");
    expect(joined).toContain('mint_tx_hash TEXT');
    expect(joined).toContain('burn_tx_hash TEXT');
    expect(joined).toContain('ALTER TABLE remittance_claims ENABLE ROW LEVEL SECURITY');
    expect(joined).toContain('remittance_claims_rls_admin');
    expect(joined).toContain('remittance_claims_rls_own_read');
    expect(joined).toContain('recipient_address = public.dukapay_request_wallet()');
    expect(joined).toContain('agent_address = public.dukapay_request_wallet()');
    expect(joined).toContain('remittance_claims_rls_auditor_read');
    expect(joined).toContain('public.dukapay_request_is_auditor()');
  });

  it('has a working down() that drops policies, table, and added columns', () => {
    const sqlStatements: string[] = [];
    const pgm = {
      sql: jest.fn((stmt: string) => {
        sqlStatements.push(stmt);
      }),
    };

    migration.down(pgm);

    const joined = sqlStatements.join('\n');
    expect(joined).toContain('DROP POLICY IF EXISTS remittance_claims_rls_auditor_read');
    expect(joined).toContain('DROP POLICY IF EXISTS remittance_claims_rls_own_read');
    expect(joined).toContain('DROP POLICY IF EXISTS remittance_claims_rls_admin');
    expect(joined).toContain('DROP TABLE IF EXISTS remittance_claims');
    expect(joined).toContain('DROP COLUMN IF EXISTS delivery_method');
  });
});
