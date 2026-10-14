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

  it('detects 1-stroop drift above 2^53 stroops without IEEE 754 float precision loss', async () => {
    // 2^53 + 1 = 9007199254740993 and 2^53 = 9007199254740992 collapse to the same
    // IEEE 754 double under parseFloat(), but differ by 1 stroop in BigInt math.
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never) // ensure table
      .mockResolvedValueOnce({
        rows: [
          {
            loan_id: '42',
            borrower: 'GBORROWER',
            amount: '9007199254740992',
            status: 'active',
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never) // agents
      .mockResolvedValue({ rows: [] } as never); // update/insert log

    mockGetLoanDetails.mockResolvedValue({
      amount: '9007199254740993',
    } as never);

    const result = await runReconciliationPass();
    expect(result.discrepanciesCount).toBe(1);
    expect(result.discrepancies[0].diffAmount).toBe(1);
    expect(result.discrepancies[0].onChainValue).toBe('9007199254740993');
    expect(result.discrepancies[0].dbValue).toBe('9007199254740992');
    expect(result.discrepancies[0].autoCorrected).toBe(true);
  });

  it('reports zero discrepancies when values above 2^53 stroops match exactly', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            loan_id: '43',
            borrower: 'GBORROWER',
            amount: '9007199254740993',
            status: 'active',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            agent_address: 'GAGENT',
            float_balance: '9007199254740993',
            collateral_balance: '9007199254740993',
            is_active: true,
          },
        ],
      } as never)
      .mockResolvedValue({ rows: [] } as never);

    mockGetLoanDetails.mockResolvedValue({
      amount: '9007199254740993',
    } as never);
    mockGetAgentVaultDetails.mockResolvedValue({
      floatBalance: '9007199254740993',
      isActive: true,
    } as never);

    const result = await runReconciliationPass();
    expect(result.status).toBe('SUCCESS');
    expect(result.discrepanciesCount).toBe(0);
    expect(result.majorAlertsCount).toBe(0);
  });
});
