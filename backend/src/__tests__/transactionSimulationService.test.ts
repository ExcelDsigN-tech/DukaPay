import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const mockCreateSorobanRpcServer = jest.fn();
const mockCacheGet = jest.fn<(key: string) => Promise<null>>().mockResolvedValue(null);
const mockCacheSet = jest
  .fn<(key: string, value: unknown, ttl?: number) => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule('../config/stellar.js', () => ({
  createSorobanRpcServer: mockCreateSorobanRpcServer,
  getStellarNetworkPassphrase: () => 'Test SDF Network ; September 2015',
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: { get: mockCacheGet, set: mockCacheSet },
}));

const { TransactionSimulationService } =
  await import('../services/transactionSimulationService.js');
const { AppError } = await import('../errors/AppError.js');

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const SOURCE = Keypair.random().publicKey();

type SimulateArgs = Parameters<
  InstanceType<typeof TransactionSimulationService>['simulateTransaction']
>;

async function expectBadRequest(args: SimulateArgs, message: string): Promise<void> {
  const service = new TransactionSimulationService();
  const promise = service.simulateTransaction(...args);
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ statusCode: 400, message });
}

describe('TransactionSimulationService input checks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Every input check must fail before the cache lookup or any RPC work.
  afterEach(() => {
    expect(mockCacheGet).not.toHaveBeenCalled();
    expect(mockCreateSorobanRpcServer).not.toHaveBeenCalled();
  });

  it('rejects an empty function name', async () => {
    await expectBadRequest([CONTRACT_ID, '', [], SOURCE], 'Contract function is required');
  });

  it('rejects a whitespace-only function name', async () => {
    await expectBadRequest([CONTRACT_ID, '   ', [], SOURCE], 'Contract function is required');
  });

  it('rejects args that are not an array', async () => {
    const notAnArray = { type: 'u32', value: 1 } as unknown as SimulateArgs[2];
    await expectBadRequest(
      [CONTRACT_ID, 'balance', notAnArray, SOURCE],
      'Simulation arguments must be an array',
    );
  });

  it('rejects an invalid source account', async () => {
    await expectBadRequest(
      [CONTRACT_ID, 'balance', [], 'GNOTAREALACCOUNT'],
      'Invalid source account format',
    );
  });

  it('rejects a contract ID passed as the source account', async () => {
    await expectBadRequest(
      [CONTRACT_ID, 'balance', [], CONTRACT_ID],
      'Invalid source account format',
    );
  });

  it('rejects an invalid contract ID', async () => {
    await expectBadRequest(
      [`C${'A'.repeat(10)}`, 'balance', [], SOURCE],
      'Invalid contract ID format',
    );
  });

  it('rejects an account ID passed as the contract ID', async () => {
    await expectBadRequest([SOURCE, 'balance', [], SOURCE], 'Invalid contract ID format');
  });
});
