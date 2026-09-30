import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from './http.js';
import type { Leaderboard, RemittanceList } from './types.js';
import {
  AuthResource,
  LoansResource,
  PoolResource,
  ScoresResource,
  RemittanceResource,
} from './resources.js';
import { ValidationError } from './errors.js';

const VALID_ADDRESS = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

describe('RemittanceResource', () => {
  it('passes list filters through as query parameters', async () => {
    const response: RemittanceList = {
      success: true,
      data: [],
      page: { next_cursor: null, snapshot_seq: '1', total_at_snapshot: 0, limit: 50 },
    };
    const get = vi.fn().mockResolvedValue(response);
    const resource = new RemittanceResource({ get } as unknown as HttpClient);

    await expect(resource.list({ status: 'pending', limit: 10 })).resolves.toBe(response);
    expect(get).toHaveBeenCalledWith('/remittances', {
      query: { status: 'pending', limit: 10 },
    });
  });

  it('lists remittances with no filters when called without params', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: [], page: {} });
    const resource = new RemittanceResource({ get } as unknown as HttpClient);

    await resource.list();

    expect(get).toHaveBeenCalledWith('/remittances', { query: {} });
  });

  it('fetches a single remittance by id', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, data: { id: 'abc' } });
    const resource = new RemittanceResource({ get } as unknown as HttpClient);

    await resource.get('abc');

    expect(get).toHaveBeenCalledWith('/remittances/abc');
  });

  it('throws ValidationError when recipient is invalid in buildSend', () => {
    const resource = new RemittanceResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() =>
      resource.buildSend({
        recipient: 'invalid-address',
        amount: 100,
        fromCurrency: 'USDC',
        toCurrency: 'EURC',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when amount is invalid in buildSend', () => {
    const resource = new RemittanceResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() =>
      resource.buildSend({
        recipient: VALID_ADDRESS,
        amount: 0,
        fromCurrency: 'USDC',
        toCurrency: 'EURC',
      }),
    ).toThrow(ValidationError);
  });

  it('creates a remittance with the body the API expects', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: { id: 'abc' } });
    const resource = new RemittanceResource({ post } as unknown as HttpClient);

    await resource.buildSend({
      recipient: VALID_ADDRESS,
      amount: 100,
      fromCurrency: 'USDC',
      toCurrency: 'EURC',
      memo: 'rent',
    });

    expect(post).toHaveBeenCalledWith('/remittances', {
      recipientAddress: VALID_ADDRESS,
      amount: 100,
      fromCurrency: 'USDC',
      toCurrency: 'EURC',
      memo: 'rent',
    });
  });

  it('omits the memo when it is not provided', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: { id: 'abc' } });
    const resource = new RemittanceResource({ post } as unknown as HttpClient);

    await resource.buildSend({
      recipient: VALID_ADDRESS,
      amount: 100,
      fromCurrency: 'USDC',
      toCurrency: 'USDC',
    });

    expect(post).toHaveBeenCalledWith('/remittances', {
      recipientAddress: VALID_ADDRESS,
      amount: 100,
      fromCurrency: 'USDC',
      toCurrency: 'USDC',
    });
  });

  it('submits a signed remittance XDR', async () => {
    const post = vi.fn().mockResolvedValue({ success: true, data: { id: 'abc' } });
    const resource = new RemittanceResource({ post } as unknown as HttpClient);

    await resource.submit('abc', 'signed-xdr');

    expect(post).toHaveBeenCalledWith('/remittances/abc/submit', { signedXdr: 'signed-xdr' });
  });
});

describe('AuthResource', () => {
  it('throws ValidationError when publicKey is invalid in challenge', () => {
    const resource = new AuthResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() => resource.challenge('invalid-address')).toThrow(ValidationError);
  });

  it('accepts valid publicKey in challenge', async () => {
    const post = vi.fn().mockResolvedValue({ message: 'test', nonce: 'test', expiresAt: '' });
    const resource = new AuthResource({ post } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.challenge(validAddress);

    expect(post).toHaveBeenCalledWith('/auth/challenge', { publicKey: validAddress }, { anonymous: true });
  });

  it('throws ValidationError when publicKey is invalid in login', () => {
    const resource = new AuthResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() =>
      resource.login({
        publicKey: 'invalid-address',
        message: 'test-message',
        signature: 'test-signature',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when message is invalid in login', () => {
    const resource = new AuthResource({ post: vi.fn() } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    expect(() =>
      resource.login({
        publicKey: validAddress,
        message: '',
        signature: 'test-signature',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError when signature is invalid in login', () => {
    const resource = new AuthResource({ post: vi.fn() } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    expect(() =>
      resource.login({
        publicKey: validAddress,
        message: 'test-message',
        signature: '',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts valid login parameters', async () => {
    const post = vi.fn().mockResolvedValue({ token: 'test', expiresAt: '', address: '', scopes: [] });
    const resource = new AuthResource({ post } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.login({
      publicKey: validAddress,
      message: 'test-message',
      signature: 'test-signature',
    });

    expect(post).toHaveBeenCalledWith(
      '/auth/login',
      {
        publicKey: validAddress,
        message: 'test-message',
        signature: 'test-signature',
      },
      { anonymous: true },
    );
  });
});

describe('LoansResource', () => {
  it('lists the loans of a borrower', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, borrower: VALID_ADDRESS, loans: [] });
    const resource = new LoansResource({ get } as unknown as HttpClient);

    await resource.list({ borrower: VALID_ADDRESS, status: 'active', limit: 20 });

    expect(get).toHaveBeenCalledWith(`/loans/borrower/${VALID_ADDRESS}`, {
      query: { status: 'active', from: undefined, to: undefined, limit: 20, cursor: undefined },
    });
  });

  it('throws ValidationError when the borrower address is invalid in list', () => {
    const resource = new LoansResource({ get: vi.fn() } as unknown as HttpClient);

    expect(() => resource.list({ borrower: 'invalid-address' })).toThrow(ValidationError);
  });

  it('throws ValidationError when loanId is not positive in get', () => {
    const resource = new LoansResource({ get: vi.fn() } as unknown as HttpClient);

    expect(() => resource.get(-1)).toThrow(ValidationError);
    expect(() => resource.get('0')).toThrow(ValidationError);
    expect(() => resource.get('not-a-number')).toThrow(ValidationError);
  });

  it('accepts valid loanId in get', async () => {
    const get = vi.fn().mockResolvedValue({ id: 1 });
    const resource = new LoansResource({ get } as unknown as HttpClient);

    await resource.get(42);
    expect(get).toHaveBeenCalledWith('/loans/42');

    await resource.get('123');
    expect(get).toHaveBeenCalledWith('/loans/123');
  });

  it('throws ValidationError when loanId is invalid in buildRepay', () => {
    const resource = new LoansResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() => resource.buildRepay(-1, 100, VALID_ADDRESS)).toThrow(ValidationError);
  });

  it('throws ValidationError when amount is invalid in buildRepay', () => {
    const resource = new LoansResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() => resource.buildRepay(1, 0, VALID_ADDRESS)).toThrow(ValidationError);
    expect(() => resource.buildRepay(1, 1.5, VALID_ADDRESS)).toThrow(ValidationError);
  });

  it('throws ValidationError when borrowerPublicKey is invalid in buildRepay', () => {
    const resource = new LoansResource({ post: vi.fn() } as unknown as HttpClient);

    expect(() => resource.buildRepay(1, 100, 'invalid-address')).toThrow(ValidationError);
  });

  it('builds a repayment against POST /loans/:loanId/repay', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      loanId: 42,
      unsignedTxXdr: 'test-xdr',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    const resource = new LoansResource({ post } as unknown as HttpClient);

    await resource.buildRepay(42, 100, VALID_ADDRESS);

    expect(post).toHaveBeenCalledWith('/loans/42/repay', {
      amount: 100,
      borrowerPublicKey: VALID_ADDRESS,
    });
  });
});

describe('PoolResource', () => {
  it('resolves the analytics envelope and preserves the snapshot payload', async () => {
    const response: PoolAnalyticsResponse = {
      success: true,
      analytics: {
        totalDeposits: 1000,
        totalWithdrawals: 250,
        totalYieldDistributed: 42.5,
        totalLoansIssued: 7,
        totalVolume: 5000,
        activeAgents: 3,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      source: 'database',
    };
    const get = vi.fn().mockResolvedValue(response);
    const resource = new PoolResource({ get } as unknown as HttpClient);

    const result = await resource.analytics();

    expect(result).toBe(response);
    expect(result.analytics.totalLoansIssued).toBe(7);
    expect(result.source).toBe('database');
    expect(get).toHaveBeenCalledWith('/pool/analytics', { anonymous: true });
  });

  it('throws ValidationError when address is invalid in depositor', () => {
    const resource = new PoolResource({ get: vi.fn() } as unknown as HttpClient);

    expect(() => resource.depositor('invalid-address')).toThrow(ValidationError);
  });

  it('accepts valid address in depositor', async () => {
    const get = vi.fn().mockResolvedValue({});
    const resource = new PoolResource({ get } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.depositor(validAddress);

    expect(get).toHaveBeenCalledWith(`/pool/depositor/${validAddress}`);
  });

  it('throws ValidationError when address is invalid in yieldHistory', () => {
    const resource = new PoolResource({ get: vi.fn() } as unknown as HttpClient);

    expect(() => resource.yieldHistory('invalid-address')).toThrow(ValidationError);
  });

  it('throws ValidationError when parameters are invalid in buildDeposit', () => {
    const resource = new PoolResource({ post: vi.fn() } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    expect(() =>
      resource.buildDeposit({
        token: 'invalid-token',
        amount: '100',
        from: validAddress,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      resource.buildDeposit({
        token: validAddress,
        amount: 'not-a-number',
        from: validAddress,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      resource.buildDeposit({
        token: validAddress,
        amount: '100',
        from: 'invalid-address',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts valid buildDeposit parameters', async () => {
    const post = vi.fn().mockResolvedValue({ xdr: 'test-xdr' });
    const resource = new PoolResource({ post } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.buildDeposit({
      token: validAddress,
      amount: '100.50',
      from: validAddress,
    });

    expect(post).toHaveBeenCalledWith('/pool/build-deposit', {
      token: validAddress,
      amount: '100.50',
      from: validAddress,
    });
  });

  it('accepts valid buildWithdraw parameters', async () => {
    const post = vi.fn().mockResolvedValue({ xdr: 'test-xdr' });
    const resource = new PoolResource({ post } as unknown as HttpClient);
    const validAddress = 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ';

    await resource.buildWithdraw({
      token: validAddress,
      shares: '50.25',
      from: validAddress,
    });

    expect(post).toHaveBeenCalledWith('/pool/build-withdraw', {
      token: validAddress,
      shares: '50.25',
      from: validAddress,
    });
  });
});

describe('ScoresResource', () => {
  it('throws ValidationError when address is invalid in get', () => {
    const resource = new ScoresResource({ get: vi.fn() } as unknown as HttpClient);

    expect(() => resource.get('invalid-address')).toThrow(ValidationError);
  });

  it('reads a score from the singular /score route', async () => {
    const get = vi.fn().mockResolvedValue({ success: true, userId: VALID_ADDRESS, score: 700 });
    const resource = new ScoresResource({ get } as unknown as HttpClient);

    await resource.get(VALID_ADDRESS);

    expect(get).toHaveBeenCalledWith(`/score/${VALID_ADDRESS}`);
  });

  it('reads the leaderboard from the singular /score route without a limit', async () => {
    const response: Leaderboard = {
      success: true,
      leaderboard: [{ userId: VALID_ADDRESS, score: 750, band: 'Excellent' }],
      source: 'database',
    };
    const get = vi.fn().mockResolvedValue(response);
    const resource = new ScoresResource({ get } as unknown as HttpClient);

    await expect(resource.leaderboard()).resolves.toBe(response);
    expect(get).toHaveBeenCalledWith('/score/leaderboard', { anonymous: true });
  });
});
