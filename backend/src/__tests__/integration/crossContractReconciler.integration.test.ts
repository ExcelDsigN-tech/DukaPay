import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { closePool, query } from '../../db/connection.js';
import { crossContractReconciler } from '../../services/crossContractReconciler.js';

// The reconciler SQL only runs against a migrated Postgres, so this suite is
// gated like the other DB-backed integration suites.
const describeIfDb = process.env.INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeIfDb('Integration: crossContractReconciler against real schema', () => {
  const testBorrower = 'G_RECONCILER_INTEGRATION_BORROWER_803';
  const repayEventId = 'evt_reconciler_int_repay_803';
  const scoreEventId = 'evt_reconciler_int_score_803';
  const unmatchedRepayEventId = 'evt_reconciler_int_unmatched_804';
  const testEventIds = [repayEventId, scoreEventId, unmatchedRepayEventId];

  const cleanup = async () => {
    await query('DELETE FROM cross_contract_reconciliation WHERE borrower = $1', [testBorrower]);
    await query('DELETE FROM contract_events WHERE event_id = ANY($1::text[])', [testEventIds]);
  };

  beforeAll(cleanup);
  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await closePool();
  });

  it('backfills a LoanRepaid event, matches its ScoreUpdated event, and is idempotent on re-run', async () => {
    await query(
      `INSERT INTO contract_events
         (event_id, contract_id, event_type, loan_id, address, amount, ledger, ledger_closed_at, tx_hash)
       VALUES
         ($1, 'CLOAN', 'LoanRepaid', 803, $3, 1000, 9000, NOW(), 'tx_repay_803'),
         ($2, 'CNFT', 'ScoreUpdated', 803, $3, NULL, 9002, NOW(), 'tx_score_803')`,
      [repayEventId, scoreEventId, testBorrower],
    );

    const firstResult = await crossContractReconciler.run();
    expect(firstResult).toMatchObject({
      backfilledRows: 1,
      processedRows: 1,
      reconciledCount: 1,
      halfAppliedCount: 0,
      stillPendingCount: 0,
      compensatedCount: 0,
      correctedCount: 0,
    });

    const rowResult = await query(
      `SELECT state, score_applied, score_ledger, attempts, expected_score_delta
       FROM cross_contract_reconciliation
       WHERE borrower = $1`,
      [testBorrower],
    );

    expect(rowResult.rows).toHaveLength(1);
    expect(rowResult.rows[0]).toMatchObject({
      state: 'reconciled',
      score_applied: true,
      score_ledger: 9002,
      attempts: 1,
      expected_score_delta: 10,
    });

    const secondResult = await crossContractReconciler.run();
    expect(secondResult).toMatchObject({
      backfilledRows: 0,
      processedRows: 0,
      reconciledCount: 0,
      halfAppliedCount: 0,
      stillPendingCount: 0,
    });

    const afterSecondRun = await query(
      `SELECT state, score_applied, score_ledger, attempts
       FROM cross_contract_reconciliation
       WHERE borrower = $1`,
      [testBorrower],
    );
    expect(afterSecondRun.rows).toHaveLength(1);
    expect(afterSecondRun.rows[0]?.attempts).toBe(1);
  });

  it('keeps a LoanRepaid event with no matching ScoreUpdated unreconciled', async () => {
    await query(
      `INSERT INTO contract_events
         (event_id, contract_id, event_type, loan_id, address, amount, ledger, ledger_closed_at, tx_hash)
       VALUES ($1, 'CLOAN', 'LoanRepaid', 804, $2, 1000, 9100, NOW(), 'tx_repay_804')`,
      [unmatchedRepayEventId, testBorrower],
    );

    const result = await crossContractReconciler.run();
    expect(result).toMatchObject({
      backfilledRows: 1,
      processedRows: 1,
      reconciledCount: 0,
      halfAppliedCount: 0,
      stillPendingCount: 1,
    });

    const rowResult = await query(
      `SELECT state, score_applied, score_ledger, attempts
       FROM cross_contract_reconciliation
       WHERE borrower = $1`,
      [testBorrower],
    );
    expect(rowResult.rows).toHaveLength(1);
    expect(rowResult.rows[0]).toMatchObject({
      score_applied: false,
      score_ledger: null,
      attempts: 1,
    });
    expect(rowResult.rows[0]?.state).not.toBe('reconciled');
  });
});
