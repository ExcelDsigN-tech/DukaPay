import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();
const mockGetOnChainCreditScore = jest.fn<(userPublicKey: string) => Promise<number>>();
const mockSetAbsoluteUserScoresBulk = jest.fn<(scores: Map<string, number>) => Promise<void>>();
const mockRecordSuccess = jest.fn<(jobName: string, durationMs: number) => void>();
const mockRecordFailure =
  jest.fn<(jobName: string, error: Error | string, durationMs: number) => void>();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    getOnChainCreditScore: mockGetOnChainCreditScore,
  },
}));

jest.unstable_mockModule('../services/scoresService.js', () => ({
  setAbsoluteUserScoresBulk: mockSetAbsoluteUserScoresBulk,
}));

jest.unstable_mockModule('../services/jobMetricsService.js', () => ({
  jobMetricsService: {
    recordSuccess: mockRecordSuccess,
    recordFailure: mockRecordFailure,
  },
}));

const logger = (await import('../utils/logger.js')).default;
const {
  SettlementSaga,
  compensationHandlers,
  runCompensation,
  normalizeState,
  crossContractReconciler,
  startCrossContractReconciler,
  stopCrossContractReconciler,
} = await import('../services/crossContractReconciler.js');

describe('crossContractReconciler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CROSS_RECONCILE_MAX_ROWS_PER_RUN;
    delete process.env.CROSS_RECONCILE_STALE_ATTEMPTS;
    delete process.env.CROSS_RECONCILE_AUTOCORRECT_ENABLED;
    delete process.env.CROSS_RECONCILE_PARTIAL_ALERT_MS;
    delete process.env.CROSS_RECONCILE_INTERVAL_MS;
  });

  afterEach(() => {
    stopCrossContractReconciler();
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  describe('normalizeState (legacy and canonical state mapping)', () => {
    it.each([
      ['pending', 'PENDING'],
      ['PENDING', 'PENDING'],
      ['half_applied', 'PARTIAL'],
      ['PARTIAL', 'PARTIAL'],
      ['reconciled', 'COMPLETED'],
      ['COMPLETED', 'COMPLETED'],
      ['failed', 'FAILED'],
      ['FAILED', 'FAILED'],
      ['unknown_value', 'PENDING'],
      ['', 'PENDING'],
    ] as const)('maps %s -> %s', (input, expected) => {
      expect(normalizeState(input)).toBe(expected);
    });
  });

  describe('SettlementSaga', () => {
    it('completes when all steps succeed in order without triggering compensation', async () => {
      const order: string[] = [];
      const comp1 = jest.fn(async () => {
        order.push('comp1');
      });
      const comp2 = jest.fn(async () => {
        order.push('comp2');
      });

      const saga = new SettlementSaga();
      saga.addStep({
        name: 'custody_change',
        action: async () => {
          order.push('step1');
        },
        compensation: comp1,
      });
      saga.addStep({
        name: 'score_mutation',
        action: async () => {
          order.push('step2');
        },
        compensation: comp2,
      });

      const result = await saga.execute();

      expect(result).toEqual({ state: 'COMPLETED' });
      expect(order).toEqual(['step1', 'step2']);
      expect(comp1).not.toHaveBeenCalled();
      expect(comp2).not.toHaveBeenCalled();
    });

    it('compensates executed steps in reverse order when a step fails and returns FAILED', async () => {
      const order: string[] = [];
      const saga = new SettlementSaga();

      saga.addStep({
        name: 'step_1',
        action: async () => {
          order.push('exec_1');
        },
        compensation: async () => {
          order.push('comp_1');
        },
      });
      saga.addStep({
        name: 'step_2',
        action: async () => {
          order.push('exec_2');
        },
        compensation: async () => {
          order.push('comp_2');
        },
      });
      saga.addStep({
        name: 'step_3_fails',
        action: async () => {
          order.push('exec_3');
          throw new Error('Soroban RPC timeout');
        },
        compensation: async () => {
          order.push('comp_3');
        },
      });

      const result = await saga.execute();

      expect(result).toEqual({ state: 'FAILED', failedStep: 'step_3_fails' });
      expect(order).toEqual(['exec_1', 'exec_2', 'exec_3', 'comp_2', 'comp_1']);
    });

    it('continues compensating remaining steps even if one compensation handler throws', async () => {
      const order: string[] = [];
      const saga = new SettlementSaga();

      saga.addStep({
        name: 'step_1',
        action: async () => {
          order.push('exec_1');
        },
        compensation: async () => {
          order.push('comp_1');
        },
      });
      saga.addStep({
        name: 'step_2',
        action: async () => {
          order.push('exec_2');
        },
        compensation: async () => {
          order.push('comp_2_throws');
          throw new Error('compensation failure');
        },
      });
      saga.addStep({
        name: 'step_3',
        action: async () => {
          throw new Error('action failure');
        },
        compensation: async () => {
          order.push('comp_3');
        },
      });

      const result = await saga.execute();

      expect(result).toEqual({ state: 'FAILED', failedStep: 'step_3' });
      expect(order).toEqual(['exec_1', 'exec_2', 'comp_2_throws', 'comp_1']);
    });
  });

  describe('runCompensation and compensationHandlers', () => {
    it.each([
      'lending_pool_deposit',
      'lending_pool_withdraw',
      'agent_vault_collateral',
      'loan_manager_repay',
      'score_update',
    ])('executes registered handler %s and returns true', async (op) => {
      const result = await runCompensation(op, { loanId: 10, borrower: 'GBORROWER' });
      expect(result).toBe(true);
    });

    it('returns false when no handler is registered for an operation', async () => {
      const result = await runCompensation('non_existent_operation', { loanId: 1 });
      expect(result).toBe(false);
    });

    it('returns false and logs error when a compensation handler throws', async () => {
      const spy = jest
        .spyOn(compensationHandlers, 'score_update')
        .mockRejectedValueOnce(new Error('handler boom'));

      const result = await runCompensation('score_update', { loanId: 99 });
      expect(result).toBe(false);

      spy.mockRestore();
    });
  });

  describe('compensatePartial', () => {
    it.each([
      ['repay', 'score_update'],
      ['default', 'score_update'],
      ['approve', 'lending_pool_deposit'],
    ] as const)(
      'runs %s partial failure through %s handler and marks state failed',
      async (operation, expectedHandler) => {
        const handlerSpy = jest.spyOn(compensationHandlers, expectedHandler);
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const compensated = await crossContractReconciler.compensatePartial({
          id: 42,
          intentKey: `Loan:${operation}:42`,
          loanId: 7,
          borrower: 'GBORROWER1',
          operation,
          disbursementLedger: 1200,
          expectedScoreDelta: operation === 'default' ? -50 : 10,
          attempts: 3,
          state: 'half_applied',
          settlementState: 'PARTIAL',
        });

        expect(compensated).toBe(true);
        expect(handlerSpy).toHaveBeenCalledWith({
          borrower: 'GBORROWER1',
          loanId: 7,
          operation,
          intentKey: `Loan:${operation}:42`,
        });
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE cross_contract_reconciliation'),
          [42, 'failed'],
        );

        handlerSpy.mockRestore();
      },
    );

    it('does not update state to failed when the compensation handler fails', async () => {
      const handlerSpy = jest
        .spyOn(compensationHandlers, 'score_update')
        .mockRejectedValueOnce(new Error('unable to compensate'));

      const compensated = await crossContractReconciler.compensatePartial({
        id: 55,
        intentKey: 'LoanRepaid:55:evt1',
        loanId: 55,
        borrower: 'GBORROWER2',
        operation: 'repay',
        disbursementLedger: 1000,
        expectedScoreDelta: 15,
        attempts: 3,
        state: 'half_applied',
        settlementState: 'PARTIAL',
      });

      expect(compensated).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
      handlerSpy.mockRestore();
    });
  });

  describe('run() state transitions', () => {
    it('transitions PENDING -> COMPLETED (reconciled) immediately when expectedScoreDelta is 0 (approve)', async () => {
      // 1. backfillPendingRows
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // 2. fetchUnresolvedRows
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            intent_key: 'LoanApproved:10:evt_approve_1',
            loan_id: 10,
            borrower: 'GBORROWER_APPROVE',
            operation: 'approve',
            disbursement_ledger: 500,
            expected_score_delta: 0,
            attempts: 0,
            state: 'pending',
          },
        ],
      });
      // 3. markReconciled(1, null, false)
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // 4. alertStuckPartials
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await crossContractReconciler.run();

      expect(result).toEqual({
        backfilledRows: 1,
        processedRows: 1,
        reconciledCount: 1,
        halfAppliedCount: 0,
        stillPendingCount: 0,
        correctedCount: 0,
        compensatedCount: 0,
        alertedPartialCount: 0,
        autoCorrectEnabled: false,
      });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("SET state = 'reconciled'"), [
        1,
        false,
        null,
      ]);
      expect(mockRecordSuccess).toHaveBeenCalledWith('crossContractReconciler', expect.any(Number));
    });

    it('transitions PENDING -> COMPLETED (reconciled) when a matching ScoreUpdated/ScoreDecreased event is found', async () => {
      // 1. backfill
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // 2. fetchUnresolvedRows
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            intent_key: 'LoanRepaid:20:evt_repay_2',
            loan_id: 20,
            borrower: 'GBORROWER_REPAY',
            operation: 'repay',
            disbursement_ledger: 1000,
            expected_score_delta: 25,
            attempts: 1,
            state: 'PENDING',
          },
        ],
      });
      // 3. findMatchingScoreLedger -> ledger 1005
      mockQuery.mockResolvedValueOnce({ rows: [{ ledger: 1005 }] });
      // 4. markReconciled(2, 1005, true)
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // 5. alertStuckPartials
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await crossContractReconciler.run();

      expect(result).toMatchObject({
        backfilledRows: 1,
        processedRows: 1,
        reconciledCount: 1,
        halfAppliedCount: 0,
        stillPendingCount: 0,
        compensatedCount: 0,
      });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('/* match-score */'), [
        'GBORROWER_REPAY',
        ['ScoreUpdated', 'ScoreDecreased'],
        1000,
      ]);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("SET state = 'reconciled'"), [
        2,
        true,
        1005,
      ]);
    });

    it('keeps row in PENDING (pending) when score event is missing and attempts < staleAttempts', async () => {
      process.env.CROSS_RECONCILE_STALE_ATTEMPTS = '3';

      // 1. backfill
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // 2. fetchUnresolvedRows (attempts = 1, so attempts + 1 = 2 < 3)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 3,
            intent_key: 'LoanRepaid:30:evt_repay_3',
            loan_id: 30,
            borrower: 'GBORROWER_WAIT',
            operation: 'repay',
            disbursement_ledger: 2000,
            expected_score_delta: 10,
            attempts: 1,
            state: 'pending',
          },
        ],
      });
      // 3. findMatchingScoreLedger -> none
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 4. markState(3, 'PENDING') -> 'pending'
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // 5. alertStuckPartials
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await crossContractReconciler.run();

      expect(result).toMatchObject({
        processedRows: 1,
        reconciledCount: 0,
        halfAppliedCount: 0,
        stillPendingCount: 1,
        compensatedCount: 0,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SET state = $2, attempts = attempts + 1'),
        [3, 'pending'],
      );
    });

    it('transitions PENDING -> PARTIAL -> FAILED with compensation and autocorrect when attempts reach staleAttempts', async () => {
      process.env.CROSS_RECONCILE_STALE_ATTEMPTS = '3';
      process.env.CROSS_RECONCILE_AUTOCORRECT_ENABLED = 'true';

      // 1. backfill
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // 2. fetchUnresolvedRows (attempts = 2, so attempts + 1 = 3 >= 3)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 4,
            intent_key: 'LoanDefaulted:40:evt_def_4',
            loan_id: 40,
            borrower: 'GBORROWER_STALE',
            operation: 'default',
            disbursement_ledger: 3000,
            expected_score_delta: -50,
            attempts: 2,
            state: 'pending',
          },
        ],
      });
      // 3. findMatchingScoreLedger -> none
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 4. markState(4, 'PARTIAL') -> 'half_applied'
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // 5. markSettlementState(4, 'FAILED') inside compensatePartial -> 'failed'
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      // 6. alertStuckPartials
      mockQuery.mockResolvedValueOnce({ rows: [] });

      mockGetOnChainCreditScore.mockResolvedValueOnce(580);
      mockSetAbsoluteUserScoresBulk.mockResolvedValueOnce();

      const result = await crossContractReconciler.run();

      expect(result).toEqual({
        backfilledRows: 0,
        processedRows: 1,
        reconciledCount: 0,
        halfAppliedCount: 1,
        stillPendingCount: 0,
        correctedCount: 1,
        compensatedCount: 1,
        alertedPartialCount: 0,
        autoCorrectEnabled: true,
      });

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('/* update */'), [
        4,
        'half_applied',
      ]);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('/* update-settlement */'), [
        4,
        'failed',
      ]);
      expect(mockGetOnChainCreditScore).toHaveBeenCalledWith('GBORROWER_STALE');
      expect(mockSetAbsoluteUserScoresBulk).toHaveBeenCalledWith(
        new Map([['GBORROWER_STALE', 580]]),
      );
    });

    it('handles on-chain score lookup failure gracefully during autocorrect', async () => {
      process.env.CROSS_RECONCILE_STALE_ATTEMPTS = '1';
      process.env.CROSS_RECONCILE_AUTOCORRECT_ENABLED = 'true';

      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // backfill
        .mockResolvedValueOnce({
          rows: [
            {
              id: 5,
              intent_key: 'LoanRepaid:50:evt_5',
              loan_id: 50,
              borrower: 'GBORROWER_ERR',
              operation: 'repay',
              disbursement_ledger: 4000,
              expected_score_delta: 20,
              attempts: 0,
              state: 'pending',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // findMatchingScoreLedger
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // markState PARTIAL
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // markSettlementState FAILED
        .mockResolvedValueOnce({ rows: [] }); // alertStuckPartials

      mockGetOnChainCreditScore.mockRejectedValueOnce(new Error('RPC node unreachable'));

      const result = await crossContractReconciler.run();

      expect(result.halfAppliedCount).toBe(1);
      expect(result.compensatedCount).toBe(1);
      expect(result.correctedCount).toBe(0);
      expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();
    });

    it('alerts on stuck PARTIAL rows older than threshold and records failure metric', async () => {
      process.env.CROSS_RECONCILE_PARTIAL_ALERT_MS = '3600000';

      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // backfill
        .mockResolvedValueOnce({ rows: [] }) // fetchUnresolvedRows
        .mockResolvedValueOnce({
          rows: [
            {
              id: 77,
              borrower: 'GBORROWER_STUCK',
              operation: 'repay',
              updated_at: '2026-01-01T00:00:00.000Z',
              state: 'half_applied',
            },
          ],
        }); // alertStuckPartials

      const result = await crossContractReconciler.run();

      expect(result.alertedPartialCount).toBe(1);
      expect(mockRecordFailure).toHaveBeenCalledWith(
        'crossContractReconciler.partial_stuck',
        expect.stringContaining('1 settlements stuck in PARTIAL > 3600000ms'),
        0,
      );
    });

    it('records failure metric and rethrows when database query fails', async () => {
      const dbError = new Error('connection terminated unexpectedly');
      mockQuery.mockRejectedValueOnce(dbError);

      await expect(crossContractReconciler.run()).rejects.toThrow(
        'connection terminated unexpectedly',
      );
      expect(mockRecordFailure).toHaveBeenCalledWith(
        'crossContractReconciler',
        dbError,
        expect.any(Number),
      );
    });
  });

  describe('idempotent re-runs', () => {
    it('is idempotent when re-run against the same ledger state', async () => {
      interface SimRow {
        id: number;
        intent_key: string;
        loan_id: number;
        borrower: string;
        operation: 'approve' | 'repay' | 'default';
        disbursement_ledger: number;
        expected_score_delta: number;
        attempts: number;
        state: string;
        score_applied: boolean;
        score_ledger: number | null;
        updated_at: string;
      }

      const reconciliationTable: SimRow[] = [];
      const contractEvents = [
        {
          event_id: 'evt_repay_100',
          event_type: 'LoanRepaid',
          loan_id: 100,
          address: 'GBORROWER_IDEMPOTENT',
          amount: 2500,
          ledger: 5000,
          tx_hash: 'tx_100',
        },
        {
          event_id: 'evt_score_100',
          event_type: 'ScoreUpdated',
          loan_id: 100,
          address: 'GBORROWER_IDEMPOTENT',
          amount: null,
          ledger: 5001,
          tx_hash: 'tx_101',
        },
      ];

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('/* backfill */')) {
          let inserted = 0;
          for (const ev of contractEvents) {
            if (!['LoanApproved', 'LoanRepaid', 'LoanDefaulted'].includes(ev.event_type)) continue;
            const intentKey = `${ev.event_type}:${ev.loan_id}:${ev.event_id}`;
            if (!reconciliationTable.some((r) => r.intent_key === intentKey)) {
              reconciliationTable.push({
                id: reconciliationTable.length + 1,
                intent_key: intentKey,
                loan_id: ev.loan_id,
                borrower: ev.address,
                operation:
                  ev.event_type === 'LoanApproved'
                    ? 'approve'
                    : ev.event_type === 'LoanRepaid'
                      ? 'repay'
                      : 'default',
                disbursement_ledger: ev.ledger,
                expected_score_delta:
                  ev.event_type === 'LoanRepaid'
                    ? Math.max(0, Math.floor((ev.amount ?? 0) / 100))
                    : ev.event_type === 'LoanDefaulted'
                      ? -50
                      : 0,
                attempts: 0,
                state: 'pending',
                score_applied: false,
                score_ledger: null,
                updated_at: new Date().toISOString(),
              });
              inserted += 1;
            }
          }
          return { rows: [], rowCount: inserted };
        }

        if (sql.includes('/* fetch-unresolved */')) {
          const unresolved = reconciliationTable.filter(
            (r) => !['reconciled', 'COMPLETED'].includes(r.state),
          );
          return { rows: unresolved, rowCount: unresolved.length };
        }

        if (sql.includes('/* match-score */')) {
          const [borrower, eventTypes, sinceLedger] = params as [string, string[], number];
          const match = contractEvents
            .filter(
              (e) =>
                e.address === borrower &&
                eventTypes.includes(e.event_type) &&
                e.ledger >= sinceLedger,
            )
            .sort((a, b) => a.ledger - b.ledger)[0];
          return { rows: match ? [{ ledger: match.ledger }] : [] };
        }

        if (sql.includes("SET state = 'reconciled'")) {
          const [id, applied, scoreLedger] = params as [number, boolean, number | null];
          const row = reconciliationTable.find((r) => r.id === id);
          if (row) {
            row.state = 'reconciled';
            row.score_applied = applied;
            row.score_ledger = scoreLedger;
            row.attempts += 1;
          }
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('/* alert-partials */')) {
          return { rows: [], rowCount: 0 };
        }

        return { rows: [], rowCount: 0 };
      });

      const firstRun = await crossContractReconciler.run();
      expect(firstRun).toMatchObject({
        backfilledRows: 1,
        processedRows: 1,
        reconciledCount: 1,
        halfAppliedCount: 0,
        stillPendingCount: 0,
      });
      expect(reconciliationTable[0]?.state).toBe('reconciled');
      expect(reconciliationTable[0]?.score_applied).toBe(true);
      expect(reconciliationTable[0]?.score_ledger).toBe(5001);
      expect(reconciliationTable[0]?.attempts).toBe(1);

      // Second run against the exact same state must be a no-op
      const secondRun = await crossContractReconciler.run();
      expect(secondRun).toMatchObject({
        backfilledRows: 0,
        processedRows: 0,
        reconciledCount: 0,
        halfAppliedCount: 0,
        stillPendingCount: 0,
        compensatedCount: 0,
        correctedCount: 0,
      });
      expect(reconciliationTable).toHaveLength(1);
      expect(reconciliationTable[0]?.attempts).toBe(1);
    });
  });

  describe('scheduler lifecycle', () => {
    it('does not start interval when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test';
      process.env.REMITTANCE_NFT_CONTRACT_ID = 'CDDDD';
      const infoSpy = jest.spyOn(logger, 'info');

      startCrossContractReconciler();

      expect(infoSpy).not.toHaveBeenCalledWith(
        'Cross-contract reconciler scheduler started',
        expect.anything(),
      );
    });
  });
});
