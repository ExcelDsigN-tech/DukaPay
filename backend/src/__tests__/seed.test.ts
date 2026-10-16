import { describe, it, expect } from '@jest/globals';
import { StrKey } from '@stellar/stellar-sdk';
import pg from 'pg';
import { devUsers, CONTRACT_ID, DEV_LENDER, runSeed } from '../seed/index.js';
import { query } from '../db/connection.js';
import { stroopsToAmount } from '../money/decimal.js';

let databaseAvailable = false;
const probePool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/dukapay',
  connectionTimeoutMillis: 1000,
});
try {
  const res = await probePool.query('SELECT 1');
  databaseAvailable = (res.rowCount ?? 0) > 0;
} catch {
  databaseAvailable = false;
} finally {
  await probePool.end().catch(() => {});
}

const describeDb = databaseAvailable ? describe : describe.skip;

describe('Dev Seed Script (#766)', () => {
  it('has valid Stellar addresses for all demo users and lender', () => {
    expect(StrKey.isValidContract(CONTRACT_ID)).toBe(true);
    expect(StrKey.isValidEd25519PublicKey(DEV_LENDER)).toBe(true);

    for (const user of devUsers) {
      expect(StrKey.isValidEd25519PublicKey(user.publicKey)).toBe(true);
      expect(StrKey.isValidEd25519PublicKey(user.userId)).toBe(true);
    }
  });

  describeDb('Database seeding integration', () => {
    it('successfully runs seed on a migrated database and seeds stroop amounts', async () => {
      await expect(runSeed()).resolves.not.toThrow();

      const indexerRes = await query('SELECT * FROM indexer_state WHERE contract = $1', [
        CONTRACT_ID,
      ]);
      expect(indexerRes.rows.length).toBeGreaterThan(0);
      expect(Number(indexerRes.rows[0].last_ledger)).toBeGreaterThan(0);

      const eventsRes = await query(
        `SELECT event_type, amount FROM contract_events WHERE event_type = 'LoanRequested' LIMIT 1`,
      );
      expect(eventsRes.rows.length).toBeGreaterThan(0);
      const rawAmount = eventsRes.rows[0].amount;
      expect(Number(rawAmount)).toBeGreaterThanOrEqual(10000000);
      expect(stroopsToAmount(rawAmount)).toBeGreaterThan(0);
    });
  });
});
