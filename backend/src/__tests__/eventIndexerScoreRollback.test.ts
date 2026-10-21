/**
 * Reorg rollback reverses the score change each event actually applied, not
 * the configured delta, so clamped changes are undone exactly (#770).
 *
 * The score upsert itself is real SQL in scoresService and is not
 * re-implemented here: each test scripts the score the database holds after
 * the forward upsert, and asserts what the indexer records and reverses.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Address, Keypair, nativeToScVal } from '@stellar/stellar-sdk';

jest.setTimeout(30000);

type Row = Record<string, unknown>;
type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Row[]; rowCount: number }>;

const mockQuery = jest.fn<QueryFn>();
const mockUpdateUserScoresBulk = jest
  .fn<(updates: Map<string, number>) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  withContext: jest.fn(),
};
mockLogger.withContext.mockImplementation(() => mockLogger);

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(
    async (fn: (client: { query: typeof mockQuery; release: () => void }) => Promise<unknown>) =>
      fn({
        query: jest.fn(async (sql: string, params?: unknown[]) => mockQuery(sql, params ?? [])),
        release: jest.fn(),
      }),
  ),
}));
jest.unstable_mockModule('../services/webhookService.js', () => ({
  SUPPORTED_WEBHOOK_EVENT_TYPES: ['LoanRepaid', 'LoanDefaulted'],
  webhookService: { dispatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}));
jest.unstable_mockModule('../services/eventStreamService.js', () => ({
  eventStreamService: { broadcast: jest.fn() },
}));
jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: {
    createNotification: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));
jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: { getScoreConfig: () => ({ repaymentDelta: 15, defaultPenalty: 50 }) },
}));
jest.unstable_mockModule('../services/scoresService.js', () => ({
  updateUserScoresBulk: mockUpdateUserScoresBulk,
}));
jest.unstable_mockModule('../utils/logger.js', () => ({ default: mockLogger }));
jest.unstable_mockModule('../utils/requestContext.js', () => ({
  createRequestId: () => 'test-request',
  runWithRequestContext: async (_requestId: string, callback: () => Promise<unknown>) => callback(),
}));
jest.unstable_mockModule('../services/pubsubService.js', () => ({
  pubsubService: { publish: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}));

const { EventIndexer } = await import('../services/eventIndexer.js');

const CONTRACT_ID = 'CINDEXERTEST';

function scAddress(address: string) {
  return nativeToScVal(Address.fromString(address), { type: 'address' });
}

function rawEvent(id: string, ledger: number, type: 'LoanRepaid' | 'LoanDefaulted', who: string) {
  const base = {
    id,
    pagingToken: `${ledger}`,
    ledger,
    ledgerClosedAt: '2026-03-29T00:00:00.000Z',
    txHash: `tx-${id}`,
    contractId: CONTRACT_ID,
  };
  const loanId = nativeToScVal(1, { type: 'u32' });
  return type === 'LoanRepaid'
    ? {
        ...base,
        topic: [nativeToScVal('LoanRepaid', { type: 'symbol' }), scAddress(who), loanId],
        value: nativeToScVal(250n, { type: 'i128' }),
      }
    : {
        ...base,
        topic: [nativeToScVal('LoanDefaulted', { type: 'symbol' }), loanId],
        value: scAddress(who),
      };
}

/**
 * Minimal stand-in for the contract_events and scores tables. Scores only
 * change when a test says what the upsert produced (`scoreAfterUpsert`).
 */
function fakeDatabase(initialScores: Record<string, number>) {
  const events: Row[] = [];
  const scores = new Map(Object.entries(initialScores));

  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO loan_events')) {
      events.push({
        event_id: params[0],
        event_type: params[1],
        address: params[3],
        ledger: params[5],
        score_delta_applied: null,
      });
      return { rows: [{ event_id: params[0] }], rowCount: 1 };
    }
    if (sql.includes('FROM scores WHERE borrower = ANY')) {
      const borrowers = params[0] as string[];
      const rows = borrowers
        .filter((b) => scores.has(b))
        .map((b) => ({ borrower: b, score: scores.get(b) }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('UPDATE contract_events') && sql.includes('score_delta_applied')) {
      const [ids, deltas] = params as [string[], number[]];
      ids.forEach((id, i) => {
        const row = events.find((e) => e.event_id === id);
        if (row) row.score_delta_applied = deltas[i];
      });
      return { rows: [], rowCount: ids.length };
    }
    if (sql.includes('SELECT event_type, address, score_delta_applied')) {
      const rows = events.filter((e) => Number(e.ledger) >= Number(params[1]));
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  });

  return { events, scores };
}

function newIndexer(rawEvents: unknown[]) {
  const indexer = new EventIndexer({ rpcUrl: 'https://rpc.test', contractId: CONTRACT_ID });
  (indexer as unknown as { rpc: { getEvents: unknown } }).rpc = {
    getEvents: async () => ({ events: rawEvents }),
  };
  return indexer;
}

function rollback(indexer: InstanceType<typeof EventIndexer>, ledger: number) {
  return (
    indexer as unknown as { rollbackFromLedger(ledger: number): Promise<void> }
  ).rollbackFromLedger(ledger);
}

/** The delta map passed to the score upsert on the rollback (second) call. */
function rollbackDeltas() {
  expect(mockUpdateUserScoresBulk).toHaveBeenCalledTimes(2);
  return Object.fromEntries(mockUpdateUserScoresBulk.mock.calls[1][0]);
}

describe('EventIndexer reorg score rollback (#770)', () => {
  let borrower: string;

  beforeEach(() => {
    jest.clearAllMocks();
    borrower = Keypair.random().publicKey();
  });

  function scoreAfterUpsert(scores: Map<string, number>, value: number) {
    mockUpdateUserScoresBulk.mockImplementationOnce(async () => {
      scores.set(borrower, value);
    });
  }

  it('reverses the configured delta when the change was not clamped', async () => {
    const { events, scores } = fakeDatabase({ [borrower]: 600 });
    scoreAfterUpsert(scores, 615);
    const indexer = newIndexer([rawEvent('evt-repaid', 13, 'LoanRepaid', borrower)]);

    await indexer.processEvents(13, 13);
    expect(events[0].score_delta_applied).toBe(15);

    await rollback(indexer, 13);
    expect(rollbackDeltas()).toEqual({ [borrower]: -15 });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('reverses only what landed when a repayment was clamped at 850', async () => {
    const { events, scores } = fakeDatabase({ [borrower]: 840 });
    scoreAfterUpsert(scores, 850);
    const indexer = newIndexer([rawEvent('evt-repaid', 13, 'LoanRepaid', borrower)]);

    await indexer.processEvents(13, 13);
    expect(events[0].score_delta_applied).toBe(10);

    await rollback(indexer, 13);
    // 850 - 10 = 840, the score before the orphaned repayment.
    expect(rollbackDeltas()).toEqual({ [borrower]: -10 });
  });

  it('reverses only what landed when a default was clamped at 300', async () => {
    const { events, scores } = fakeDatabase({ [borrower]: 310 });
    scoreAfterUpsert(scores, 300);
    const indexer = newIndexer([rawEvent('evt-defaulted', 13, 'LoanDefaulted', borrower)]);

    await indexer.processEvents(13, 13);
    expect(events[0].score_delta_applied).toBe(-10);

    await rollback(indexer, 13);
    // 300 + 10 = 310, the score before the orphaned default.
    expect(rollbackDeltas()).toEqual({ [borrower]: 10 });
  });

  it('stores a batch change on the last event of the borrower and reverses it once', async () => {
    const { events, scores } = fakeDatabase({ [borrower]: 830 });
    // Two repayments sum to +30; the single upsert clamps 860 to 850.
    scoreAfterUpsert(scores, 850);
    const indexer = newIndexer([
      rawEvent('evt-repaid-1', 13, 'LoanRepaid', borrower),
      rawEvent('evt-repaid-2', 14, 'LoanRepaid', borrower),
    ]);

    await indexer.processEvents(13, 14);
    expect(mockUpdateUserScoresBulk.mock.calls[0][0].get(borrower)).toBe(30);
    expect(events.map((e) => e.score_delta_applied)).toEqual([0, 20]);

    await rollback(indexer, 13);
    expect(rollbackDeltas()).toEqual({ [borrower]: -20 });
  });

  it('records the change from the 500 baseline for a borrower with no score row', async () => {
    const { events, scores } = fakeDatabase({});
    scoreAfterUpsert(scores, 515);
    const indexer = newIndexer([rawEvent('evt-repaid', 13, 'LoanRepaid', borrower)]);

    await indexer.processEvents(13, 13);
    expect(events[0].score_delta_applied).toBe(15);
  });

  it('falls back to the configured delta and warns for events without a recorded delta', async () => {
    const { events } = fakeDatabase({});
    events.push(
      {
        event_id: 'legacy-repaid',
        event_type: 'LoanRepaid',
        address: borrower,
        ledger: 13,
        score_delta_applied: null,
      },
      {
        event_id: 'legacy-defaulted',
        event_type: 'LoanDefaulted',
        address: borrower,
        ledger: 14,
        score_delta_applied: null,
      },
    );
    const indexer = newIndexer([]);

    await rollback(indexer, 13);
    expect(mockUpdateUserScoresBulk).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(mockUpdateUserScoresBulk.mock.calls[0][0])).toEqual({
      [borrower]: -15 + 50,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('without a recorded applied delta'),
      { rollbackLedger: 13, eventsWithoutAppliedDelta: 2 },
    );
  });
});
