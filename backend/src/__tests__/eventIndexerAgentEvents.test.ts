/**
 * Agent registry / agent vault event indexing (Issue #774).
 *
 * Covers: each of the nine agent events parses and projects into
 * agent_vaults with the event's resulting balance (not a delta); the
 * agent_vault/lending-pool CollateralDeposited name collision is
 * disambiguated by contractId; and reorg rollback re-derives or deletes
 * the agent_vaults projection rather than undoing a delta.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';

jest.setTimeout(30000);

const mockQuery =
  jest.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>();
const mockDispatch = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockBroadcast = jest.fn();
const mockCreateNotification = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockGetScoreConfig = jest.fn(() => ({ repaymentDelta: 15, defaultPenalty: 50 }));
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

const supportedWebhookEventTypes = [
  'AgentRegistered',
  'AgentStatusChanged',
  'BondUpdated',
  'CollateralDeposited',
  'CollateralWithdrawn',
  'FloatMinted',
  'FloatBurned',
  'FloatTransferred',
  'VaultSettled',
  'LoanRepaid',
  'LoanDefaulted',
  'CollateralLiquidated',
] as const;

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(
    async (fn: (client: { query: typeof mockQuery; release: () => void }) => Promise<unknown>) => {
      const mockClient = {
        query: jest.fn(async (sql: string, params?: unknown[]) => mockQuery(sql, params ?? [])),
        release: jest.fn(),
      };
      return fn(mockClient);
    },
  ),
}));

jest.unstable_mockModule('../services/webhookService.js', () => ({
  SUPPORTED_WEBHOOK_EVENT_TYPES: supportedWebhookEventTypes,
  webhookService: { dispatch: mockDispatch },
}));

jest.unstable_mockModule('../services/eventStreamService.js', () => ({
  eventStreamService: { broadcast: mockBroadcast },
}));

jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: { createNotification: mockCreateNotification },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: { getScoreConfig: mockGetScoreConfig },
}));

jest.unstable_mockModule('../services/scoresService.js', () => ({
  updateUserScoresBulk: mockUpdateUserScoresBulk,
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: mockLogger,
}));

jest.unstable_mockModule('../utils/requestContext.js', () => ({
  createRequestId: () => 'test-request',
  runWithRequestContext: async (_requestId: string, callback: () => Promise<unknown>) => callback(),
}));

jest.unstable_mockModule('../services/pubsubService.js', () => ({
  pubsubService: { publish: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}));

const { EventIndexer } = await import('../services/eventIndexer.js');

const AGENT_VAULT_CONTRACT = 'CAGENTVAULT';
const AGENT_REGISTRY_CONTRACT = 'CAGENTREGISTRY';
const LENDING_POOL_CONTRACT = 'CLENDINGPOOL';

function makeAddr() {
  return Keypair.random().publicKey();
}

function scAddress(address: string) {
  return nativeToScVal(Address.fromString(address), { type: 'address' });
}

function scSymbol(value: string) {
  return nativeToScVal(value, { type: 'symbol' });
}

function scI128(value: number | bigint) {
  return nativeToScVal(BigInt(value), { type: 'i128' });
}

function makeAgentEvent(params: {
  id: string;
  ledger: number;
  type: string;
  contractId: string;
  topic: ReturnType<typeof nativeToScVal>[];
  value: ReturnType<typeof nativeToScVal>;
}) {
  return {
    id: params.id,
    pagingToken: `${params.ledger}`,
    ledger: params.ledger,
    ledgerClosedAt: '2026-03-29T00:00:00.000Z',
    txHash: `tx-${params.id}`,
    contractId: params.contractId,
    topic: params.topic,
    value: params.value,
  };
}

function makeIndexer() {
  return new EventIndexer({
    rpcUrl: 'https://rpc.test',
    contractIds: [AGENT_VAULT_CONTRACT, AGENT_REGISTRY_CONTRACT, LENDING_POOL_CONTRACT],
    agentVaultContractIds: [AGENT_VAULT_CONTRACT],
    agentRegistryContractIds: [AGENT_REGISTRY_CONTRACT],
  });
}

/** Captures every INSERT INTO agent_vaults call's bound params. */
function captureAgentVaultUpserts(): unknown[][] {
  const upserts: unknown[][] = [];
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO loan_events')) {
      return { rows: [{ event_id: params[0] }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO agent_vaults')) {
      upserts.push(params);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return upserts;
}

describe('EventIndexer: agent registry / agent vault events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetScoreConfig.mockReturnValue({ repaymentDelta: 15, defaultPenalty: 50 });
  });

  it('AgentRegistered projects status=Pending, bond, and region', async () => {
    const agent = makeAddr();
    const upserts = captureAgentVaultUpserts();

    await makeIndexer().ingestRawEvents([
      makeAgentEvent({
        id: 'evt-reg',
        ledger: 1,
        type: 'AgentRegistered',
        contractId: AGENT_REGISTRY_CONTRACT,
        topic: [scSymbol('AgentRegistered'), scAddress(agent)],
        value: nativeToScVal([
          nativeToScVal('kyc-1', { type: 'symbol' }),
          BigInt(5000),
          'west-africa',
        ]),
      }),
    ]);

    expect(upserts).toHaveLength(1);
    const [agentAddress, status, bondAmount, region] = upserts[0]!;
    expect(agentAddress).toBe(agent);
    expect(status).toBe('Pending');
    expect(bondAmount).toBe('5000');
    expect(region).toBe('west-africa');
  });

  it('AgentStatusChanged projects the new status tag', async () => {
    const agent = makeAddr();
    const upserts = captureAgentVaultUpserts();

    await makeIndexer().ingestRawEvents([
      makeAgentEvent({
        id: 'evt-status',
        ledger: 2,
        type: 'AgentStatusChanged',
        contractId: AGENT_REGISTRY_CONTRACT,
        topic: [scSymbol('AgentStatusChanged'), scAddress(agent)],
        // Unit enum variants encode on chain as ScVec([ScSymbol(name)]).
        value: xdr.ScVal.scvVec([
          xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Pending')]),
          xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Active')]),
        ]),
      }),
    ]);

    expect(upserts).toHaveLength(1);
    const [, status, , , , , , isActive] = upserts[0]!;
    expect(status).toBe('Active');
    expect(isActive).toBe(true);
  });

  it('BondUpdated projects the new bond amount', async () => {
    const agent = makeAddr();
    const upserts = captureAgentVaultUpserts();

    await makeIndexer().ingestRawEvents([
      makeAgentEvent({
        id: 'evt-bond',
        ledger: 3,
        type: 'BondUpdated',
        contractId: AGENT_REGISTRY_CONTRACT,
        topic: [scSymbol('BondUpdated'), scAddress(agent)],
        value: scI128(7500),
      }),
    ]);

    const [, , bondAmount] = upserts[0]!;
    expect(bondAmount).toBe('7500');
  });

  it("agent_vault's CollateralDeposited projects resulting collateral, disambiguated by contractId", async () => {
    const agent = makeAddr();
    const upserts = captureAgentVaultUpserts();

    await makeIndexer().ingestRawEvents([
      makeAgentEvent({
        id: 'evt-coldep',
        ledger: 4,
        type: 'CollateralDeposited',
        contractId: AGENT_VAULT_CONTRACT,
        topic: [scSymbol('CollateralDeposited'), scAddress(agent)],
        value: nativeToScVal([BigInt(1000), BigInt(9000)]),
      }),
    ]);

    expect(upserts).toHaveLength(1);
    const [, , , , , , collateralBalance] = upserts[0]!;
    expect(collateralBalance).toBe('9000');
  });

  it("lending pool's CollateralDeposited is unaffected by the agent_vault branch", async () => {
    const borrower = makeAddr();
    const insertedLoanEvents: unknown[][] = [];
    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO loan_events')) {
        insertedLoanEvents.push(params);
        return { rows: [{ event_id: params[0] }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO agent_vaults')) {
        throw new Error('must not write agent_vaults for the lending pool contract');
      }
      return { rows: [], rowCount: 0 };
    });

    await makeIndexer().ingestRawEvents([
      makeAgentEvent({
        id: 'evt-pool-coldep',
        ledger: 5,
        type: 'CollateralDeposited',
        contractId: LENDING_POOL_CONTRACT,
        topic: [
          scSymbol('CollateralDeposited'),
          scAddress(borrower),
          nativeToScVal(1, { type: 'u32' }),
        ],
        value: scI128(2500),
      }),
    ]);

    expect(insertedLoanEvents).toHaveLength(1);
  });

  it('CollateralWithdrawn projects resulting collateral', async () => {
    const agent = makeAddr();
    const upserts = captureAgentVaultUpserts();

    await makeIndexer().ingestRawEvents([
      makeAgentEvent({
        id: 'evt-colwd',
        ledger: 6,
        type: 'CollateralWithdrawn',
        contractId: AGENT_VAULT_CONTRACT,
        topic: [scSymbol('CollateralWithdrawn'), scAddress(agent)],
        value: nativeToScVal([BigInt(500), BigInt(8500)]),
      }),
    ]);

    const [, , , , , , collateralBalance] = upserts[0]!;
    expect(collateralBalance).toBe('8500');
  });

  it('FloatMinted projects resulting float balance', async () => {
    const agent = makeAddr();
    const upserts = captureAgentVaultUpserts();

    await makeIndexer().ingestRawEvents([
      makeAgentEvent({
        id: 'evt-floatmint',
        ledger: 7,
        type: 'FloatMinted',
        contractId: AGENT_VAULT_CONTRACT,
        topic: [scSymbol('FloatMinted'), scAddress(agent)],
        value: nativeToScVal([BigInt(2000), BigInt(6000)]),
      }),
    ]);

    const [, , , , , floatBalance] = upserts[0]!;
    expect(floatBalance).toBe('6000');
  });

  it('FloatBurned projects resulting float balance', async () => {
    const agent = makeAddr();
    const upserts = captureAgentVaultUpserts();

    await makeIndexer().ingestRawEvents([
      makeAgentEvent({
        id: 'evt-floatburn',
        ledger: 8,
        type: 'FloatBurned',
        contractId: AGENT_VAULT_CONTRACT,
        topic: [scSymbol('FloatBurned'), scAddress(agent)],
        value: nativeToScVal([BigInt(1500), BigInt(4500)]),
      }),
    ]);

    const [, , , , , floatBalance] = upserts[0]!;
    expect(floatBalance).toBe('4500');
  });

  it('VaultSettled projects resulting float balance from (delta, new_float)', async () => {
    const agent = makeAddr();
    const upserts = captureAgentVaultUpserts();

    await makeIndexer().ingestRawEvents([
      makeAgentEvent({
        id: 'evt-settled',
        ledger: 9,
        type: 'VaultSettled',
        contractId: AGENT_VAULT_CONTRACT,
        topic: [scSymbol('VaultSettled'), scAddress(agent)],
        value: nativeToScVal([BigInt(-300), BigInt(4200)]),
      }),
    ]);

    const [, , , , , floatBalance] = upserts[0]!;
    expect(floatBalance).toBe('4200');
  });

  /** Records agent_vaults UPDATEs; `inserted` controls the event dedupe result. */
  function captureFloatDeltas(inserted: boolean): unknown[][] {
    const updates: unknown[][] = [];
    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO loan_events')) {
        return inserted
          ? { rows: [{ event_id: params[0] }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO agent_vaults')) {
        throw new Error('FloatTransferred must not upsert agent_vaults');
      }
      if (sql.includes('UPDATE agent_vaults')) {
        updates.push([sql, ...params]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    return updates;
  }

  function transferEvent(from: string, to: string, amount: bigint) {
    return makeAgentEvent({
      id: 'evt-transfer',
      ledger: 10,
      type: 'FloatTransferred',
      contractId: AGENT_VAULT_CONTRACT,
      topic: [scSymbol('FloatTransferred'), scAddress(from), scAddress(to)],
      value: scI128(amount),
    });
  }

  it('FloatTransferred moves the exact amount from the sender to the receiver float', async () => {
    const from = makeAddr();
    const to = makeAddr();
    const updates = captureFloatDeltas(true);
    // Above 2^53 to prove the delta never passes through Number.
    const amount = 9_007_199_254_740_993n;

    await makeIndexer().ingestRawEvents([transferEvent(from, to, amount)]);

    expect(updates).toHaveLength(2);
    const [debitSql, debitAmount, debitAgent] = updates[0]!;
    const [creditSql, creditAmount, creditAgent] = updates[1]!;
    expect(debitSql).toContain('float_balance = float_balance - $1');
    expect(debitAmount).toBe(amount.toString());
    expect(debitAgent).toBe(from);
    expect(creditSql).toContain('float_balance = float_balance + $1');
    expect(creditAmount).toBe(amount.toString());
    expect(creditAgent).toBe(to);
  });

  it('FloatTransferred ingested twice applies its delta only once', async () => {
    const updates = captureFloatDeltas(false);

    await makeIndexer().ingestRawEvents([transferEvent(makeAddr(), makeAddr(), 1000n)]);

    expect(updates).toHaveLength(0);
  });
});

describe('EventIndexer: agent_vaults reorg rollback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetScoreConfig.mockReturnValue({ repaymentDelta: 15, defaultPenalty: 50 });
  });

  it('deletes the agent_vaults row when no AgentRegistered event survives the rollback', async () => {
    const agent = makeAddr();
    const deletedAgentVaults: unknown[][] = [];

    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT event_type, address') && sql.includes('FROM contract_events')) {
        return { rows: [{ event_type: 'AgentStatusChanged', address: agent }], rowCount: 1 };
      }
      if (sql.includes("event_type = 'AgentRegistered'")) {
        return { rows: [], rowCount: 0 }; // nothing survives
      }
      if (sql.startsWith('DELETE FROM agent_vaults')) {
        deletedAgentVaults.push(params);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const indexer = makeIndexer();
    await (
      indexer as unknown as { rollbackFromLedger: (ledger: number) => Promise<void> }
    ).rollbackFromLedger(100);

    expect(deletedAgentVaults).toEqual([[agent]]);
  });

  it('recomputes agent_vaults from the latest surviving event per field when AgentRegistered survives', async () => {
    const agent = makeAddr();
    const upserts: unknown[][] = [];
    const encode = (val: ReturnType<typeof nativeToScVal>) => val.toXDR('base64');

    const agentRegisteredValue = encode(
      nativeToScVal([nativeToScVal('kyc-1', { type: 'symbol' }), BigInt(3000), 'kenya']),
    );
    const floatMintedValue = encode(nativeToScVal([BigInt(1000), BigInt(4200)]));

    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 };

      if (sql.includes('SELECT event_type, address') && sql.includes('FROM contract_events')) {
        return { rows: [{ event_type: 'FloatMinted', address: agent }], rowCount: 1 };
      }

      if (
        sql.includes("event_type = 'AgentRegistered'") &&
        sql.includes('ORDER BY ledger DESC LIMIT 1')
      ) {
        return { rows: [{ value: agentRegisteredValue }], rowCount: 1 };
      }

      if (sql.includes('event_type = ANY($2::text[])')) {
        const eventTypes = params[1] as string[];
        // In this scenario, AgentRegistered is the latest surviving row for
        // the status/bond lookups (both include 'AgentRegistered' in their
        // type list); FloatMinted is the latest surviving row for the float
        // lookup; nothing survives for the collateral lookup.
        if (eventTypes.includes('AgentRegistered')) {
          return {
            rows: [{ event_type: 'AgentRegistered', value: agentRegisteredValue }],
            rowCount: 1,
          };
        }
        if (eventTypes.includes('FloatMinted')) {
          return { rows: [{ event_type: 'FloatMinted', value: floatMintedValue }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes('INSERT INTO agent_vaults')) {
        upserts.push(params);
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });

    const indexer = makeIndexer();
    await (
      indexer as unknown as { rollbackFromLedger: (ledger: number) => Promise<void> }
    ).rollbackFromLedger(100);

    expect(upserts).toHaveLength(1);
    const [agentAddress, status, bondAmount, region, , floatBalance, collateralBalance] =
      upserts[0]!;
    expect(agentAddress).toBe(agent);
    expect(status).toBe('Pending'); // fell back to the AgentRegistered default
    expect(bondAmount).toBe('3000'); // fell back to AgentRegistered's bond_amount
    expect(region).toBe('kenya');
    expect(floatBalance).toBe('4200'); // recomputed from the surviving FloatMinted event
    expect(collateralBalance).toBe('0'); // no surviving collateral event; reset to default
  });
});
