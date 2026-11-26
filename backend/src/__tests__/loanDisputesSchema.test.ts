import { it, expect, afterAll } from '@jest/globals';
import { query, closePool } from '../db/connection.js';
import { describeIfDb } from './helpers/dbProbe.js';

describeIfDb('loan_disputes schema', () => {
  afterAll(async () => {
    await closePool();
  });
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
