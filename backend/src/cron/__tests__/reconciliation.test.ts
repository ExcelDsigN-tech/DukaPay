import { describe, it, expect, beforeEach, beforeAll, jest } from '@jest/globals';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetLoanDetails = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetAgentVaultDetails = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../../services/sorobanService.js', () => ({
  sorobanService: {
    getLoanDetails: mockGetLoanDetails,
    getAgentVaultDetails: mockGetAgentVaultDetails,
  },
}));

let runReconciliationPass: typeof import('../reconciliation.js').runReconciliationPass;

beforeAll(async () => {
  const mod = await import('../reconciliation.js');
  runReconciliationPass = mod.runReconciliationPass;
});

describe('State Synchronization & Automated Reconciliation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetLoanDetails.mockReset();
    mockGetAgentVaultDetails.mockReset();
  });

  it('runs reconciliation pass cleanly when DB and contract state match', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never);

    const result = await runReconciliationPass();
    expect(result.status).toBe('SUCCESS');
    expect(result.discrepanciesCount).toBe(0);
    expect(result.majorAlertsCount).toBe(0);
  });

  it('detects minor drift and auto-corrects DB balance', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never) // ensure table
      .mockResolvedValueOnce({
        rows: [{ loan_id: '1', borrower: 'GBORROWER', amount: '500', status: 'active' }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never) // agents
      .mockResolvedValue({ rows: [] } as never); // update/insert log

    mockGetLoanDetails.mockResolvedValue({
      amount: '505',
    } as never);

    const result = await runReconciliationPass();
    expect(result.discrepanciesCount).toBe(1);
    expect(result.discrepancies[0].autoCorrected).toBe(true);
    expect(result.autoCorrectedCount).toBe(1);
  });

  it('detects major drift (> $100) and triggers major alert without auto-correction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{ loan_id: '1', borrower: 'GBORROWER', amount: '500', status: 'active' }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValue({ rows: [] } as never);

    mockGetLoanDetails.mockResolvedValue({
      amount: '750',
    } as never);

    const result = await runReconciliationPass();
    expect(result.status).toBe('ALERT');
    expect(result.majorAlertsCount).toBe(1);
    expect(result.discrepancies[0].isMajor).toBe(true);
    expect(result.discrepancies[0].autoCorrected).toBe(false);
  });

  it('detects a 1-stroop difference above 2^53 without precision loss (Issue #748)', async () => {
    // 2^53 = 9007199254740992; values straddling it would silently collide
    // under Number() / parseFloat(), masking a real drift.
    const dbAmount = '9007199254740993';
    const onChainAmount = '9007199254740992';

    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never) // ensure table
      .mockResolvedValueOnce({
        rows: [{ loan_id: '1', borrower: 'GBORROWER', amount: dbAmount, status: 'active' }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never) // agents
      .mockResolvedValue({ rows: [] } as never); // update/insert log

    mockGetLoanDetails.mockResolvedValue({ amount: onChainAmount } as never);

    const result = await runReconciliationPass();
    expect(result.discrepanciesCount).toBe(1);
    const [discrepancy] = result.discrepancies;
    expect(discrepancy.diffAmount).toBe('0.0000001');
    expect(discrepancy.dbValue).toBe('900719925.4740993');
    expect(discrepancy.onChainValue).toBe('900719925.4740992');
    expect(discrepancy.autoCorrected).toBe(true);
  });

  it('reports zero drift for identical amounts above 2^53 (exact-match case)', async () => {
    const amount = '9007199254740993';

    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{ loan_id: '1', borrower: 'GBORROWER', amount, status: 'active' }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValue({ rows: [] } as never);

    mockGetLoanDetails.mockResolvedValue({ amount } as never);

    const result = await runReconciliationPass();
    expect(result.discrepanciesCount).toBe(0);
    expect(result.status).toBe('SUCCESS');
  });
});
