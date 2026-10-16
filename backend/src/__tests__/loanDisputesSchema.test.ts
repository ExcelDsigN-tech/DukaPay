import { describe, it, expect } from '@jest/globals';
import { query } from '../db/connection.js';
import pg from 'pg';

let databaseAvailable = false;
if (process.env.DATABASE_TESTS === 'false') {
  databaseAvailable = false;
} else if (process.env.DATABASE_TESTS === 'true') {
  databaseAvailable = true;
} else {
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
}

const describeIf = (name: string, fn: () => void) => {
  if (databaseAvailable) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (skipped: no database)`, fn);
  }
};

describeIf('loan_disputes schema', () => {
  it('should successfully insert a loan dispute against the schema', async () => {
    const result = await query(
      `INSERT INTO loan_disputes (loan_id, borrower, reason) VALUES ($1, $2, $3) RETURNING id`,
      [100, 'G_DISPUTE_TEST_BORROWER', 'Test dispute reason'],
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].id).toBeDefined();

    const selectResult = await query(`SELECT * FROM loan_disputes WHERE id = $1`, [
      result.rows[0].id,
    ]);
    expect(selectResult.rows[0].loan_id).toBe(100);
    expect(selectResult.rows[0].borrower).toBe('G_DISPUTE_TEST_BORROWER');
    expect(selectResult.rows[0].status).toBe('open');

    await query('DELETE FROM loan_disputes WHERE id = $1', [result.rows[0].id]);
  });
});
