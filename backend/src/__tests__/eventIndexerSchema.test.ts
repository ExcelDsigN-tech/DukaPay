import { it, expect, beforeAll, afterAll } from '@jest/globals';
import { query, closePool } from '../db/connection.js';
import { describeIfDb } from './helpers/dbProbe.js';

// Regression for #847. The unit tests for EventIndexer mock the database, so
// they cannot notice that `loan_events` is a backward-compat view without the
// `address`, `interest_rate_bps` and `term_ledgers` columns. This runs the
// indexer's INSERT column list against a real migrated schema.
//
// The column list below must stay in step with `EventIndexer.storeEvents`.
const INSERT_COLUMNS = `
  event_id, event_type, loan_id, address, amount, ledger, ledger_closed_at,
  tx_hash, contract_id, topics, value, interest_rate_bps, term_ledgers
`;

const EVENT_PREFIX = 'it-847-';

function insertInto(target: string): string {
  return `INSERT INTO ${target} (${INSERT_COLUMNS})
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12)
          ON CONFLICT DO NOTHING
          RETURNING event_id`;
}

function params(eventId: string, eventType: string, loanId: number, borrower: string) {
  return [
    eventId,
    eventType,
    loanId,
    borrower,
    1_000_000, // stroops
    4242,
    `${eventId}-tx`,
    'CIT847CONTRACT',
    JSON.stringify(['topic']),
    'value',
    1200,
    10_000,
  ];
}

describeIfDb('EventIndexer insert target against the real schema (#847)', () => {
  const borrower = 'G_IT_847_BORROWER';

  async function cleanup() {
    await query('DELETE FROM contract_events WHERE event_id LIKE $1', [`${EVENT_PREFIX}%`]);
  }

  beforeAll(cleanup);
  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await closePool();
    }
  });

  it('stores LoanRequested and LoanRepaid events in contract_events and reads them back', async () => {
    for (const [eventId, eventType] of [
      [`${EVENT_PREFIX}requested`, 'LoanRequested'],
      [`${EVENT_PREFIX}repaid`, 'LoanRepaid'],
    ]) {
      const inserted = await query(
        insertInto('contract_events'),
        params(eventId, eventType, 847, borrower),
      );
      expect(inserted.rowCount).toBe(1);
    }

    const stored = await query(
      `SELECT event_type, address, interest_rate_bps, term_ledgers
         FROM contract_events WHERE event_id LIKE $1 ORDER BY event_id`,
      [`${EVENT_PREFIX}%`],
    );
    expect(stored.rows.map((r: { event_type: string }) => r.event_type)).toEqual([
      'LoanRepaid',
      'LoanRequested',
    ]);
    for (const row of stored.rows) {
      expect(row.address).toBe(borrower);
      expect(row.interest_rate_bps).toBe(1200);
      expect(row.term_ledgers).toBe(10_000);
    }
  });

  it('exposes the same events through the loan_events view as `borrower`', async () => {
    const viaView = await query(`SELECT borrower FROM loan_events WHERE event_id LIKE $1`, [
      `${EVENT_PREFIX}%`,
    ]);
    expect(viaView.rows.length).toBeGreaterThan(0);
    expect(viaView.rows.every((r: { borrower: string }) => r.borrower === borrower)).toBe(true);
  });

  it('cannot take the same insert through the loan_events view (why #847 happened)', async () => {
    await expect(
      query(
        insertInto('loan_events'),
        params(`${EVENT_PREFIX}view`, 'LoanRequested', 848, borrower),
      ),
    ).rejects.toThrow(/address|loan_events/);
  });
});
