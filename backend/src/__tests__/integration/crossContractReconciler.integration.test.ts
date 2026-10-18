import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

interface ContractEventRecord {
  event_id: string;
  contract_id: string;
  event_type: string;
  loan_id: number | null;
  address: string;
  amount: number | null;
  ledger: number;
  tx_hash: string;
}

interface ReconciliationRecord {
  id: number;
  intent_key: string;
  loan_id: number | null;
  borrower: string;
  operation: 'approve' | 'repay' | 'default';
  disbursement_ledger: number | null;
  disbursement_tx_hash: string | null;
  expected_score_delta: number;
  score_applied: boolean;
  score_ledger: number | null;
  state: string;
  attempts: number;
  updated_at: string;
}

const contractEventsStore: ContractEventRecord[] = [];
const reconciliationStore: ReconciliationRecord[] = [];

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn(async (sql: string, params?: unknown[]) => {
  if (sql.includes('INSERT INTO contract_events')) {
    const [repayEventId, scoreEventId, borrower] = params as [string, string, string];
    contractEventsStore.push(
      {
        event_id: repayEventId,
        contract_id: 'CLOAN',
        event_type: 'LoanRepaid',
        loan_id: 803,
        address: borrower,
        amount: 1000,
        ledger: 9000,
        tx_hash: 'tx_repay_803',
      },
      {
        event_id: scoreEventId,
        contract_id: 'CNFT',
        event_type: 'ScoreUpdated',
        loan_id: 803,
        address: borrower,
        amount: null,
        ledger: 9002,
        tx_hash: 'tx_score_803',
      },
    );
    return { rows: [], rowCount: 2 };
  }

  if (sql.includes('/* backfill */')) {
    let inserted = 0;
    for (const ce of contractEventsStore) {
      if (!['LoanApproved', 'LoanRepaid', 'LoanDefaulted'].includes(ce.event_type)) continue;
      if (!ce.address) continue;
      const intentKey = `${ce.event_type}:${ce.loan_id ?? '-'}:${ce.event_id}`;
      if (reconciliationStore.some((r) => r.intent_key === intentKey)) continue;

      const operation =
        ce.event_type === 'LoanApproved'
          ? 'approve'
          : ce.event_type === 'LoanRepaid'
            ? 'repay'
            : 'default';
      const expectedScoreDelta =
        ce.event_type === 'LoanRepaid'
          ? Math.max(0, Math.floor((ce.amount ?? 0) / 100))
          : ce.event_type === 'LoanDefaulted'
            ? -50
            : 0;

      reconciliationStore.push({
        id: reconciliationStore.length + 1,
        intent_key: intentKey,
        loan_id: ce.loan_id,
        borrower: ce.address,
        operation,
        disbursement_ledger: ce.ledger,
        disbursement_tx_hash: ce.tx_hash,
        expected_score_delta: expectedScoreDelta,
        score_applied: false,
        score_ledger: null,
        state: 'pending',
        attempts: 0,
        updated_at: new Date().toISOString(),
      });
      inserted += 1;
    }
    return { rows: [], rowCount: inserted };
  }

  if (sql.includes('/* fetch-unresolved */')) {
    const limit = Number(params?.[0] ?? 500);
    const rows = reconciliationStore
      .filter(
        (r) =>
          ['pending', 'half_applied', 'PENDING', 'PARTIAL', 'failed'].includes(r.state) &&
          !['reconciled', 'COMPLETED'].includes(r.state),
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, limit);
    return { rows, rowCount: rows.length };
  }

  if (sql.includes('/* match-score */')) {
    const [borrower, eventTypes, sinceLedger] = params as [string, string[], number];
    const matched = contractEventsStore
      .filter(
        (ce) =>
          ce.address === borrower && eventTypes.includes(ce.event_type) && ce.ledger >= sinceLedger,
      )
      .sort((a, b) => a.ledger - b.ledger)[0];
    return {
      rows: matched ? [{ ledger: matched.ledger }] : [],
      rowCount: matched ? 1 : 0,
    };
  }

  if (sql.includes("SET state = 'reconciled'")) {
    const [id, applied, scoreLedger] = params as [number, boolean, number | null];
    const row = reconciliationStore.find((r) => r.id === id);
    if (row) {
      row.state = 'reconciled';
      row.score_applied = applied;
      row.score_ledger = scoreLedger;
      row.attempts += 1;
      row.updated_at = new Date().toISOString();
    }
    return { rows: [], rowCount: row ? 1 : 0 };
  }

  if (sql.includes('/* alert-partials */')) {
    return { rows: [], rowCount: 0 };
  }

  if (sql.includes('FROM cross_contract_reconciliation') && sql.includes('WHERE borrower = $1')) {
    const [borrower] = params as [string];
    const rows = reconciliationStore.filter((r) => r.borrower === borrower);
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
});

jest.unstable_mockModule('../../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

const { query } = await import('../../db/connection.js');
const { crossContractReconciler } = await import('../../services/crossContractReconciler.js');

describe('Integration: crossContractReconciler happy path', () => {
  const testBorrower = 'G_RECONCILER_INTEGRATION_BORROWER_803';
  const repayEventId = 'evt_reconciler_int_repay_803';
  const scoreEventId = 'evt_reconciler_int_score_803';

  beforeEach(() => {
    contractEventsStore.length = 0;
    reconciliationStore.length = 0;
    jest.clearAllMocks();
  });

  afterEach(() => {
    contractEventsStore.length = 0;
    reconciliationStore.length = 0;
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
});
