import { describe, expect, it, vi } from 'vitest';
import { DukaPayClient } from './client.js';
import { DukaPayError } from './errors.js';
import { HttpClient } from './http.js';
import type { Session } from './types.js';

const SESSION: Session = {
  token: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  address: 'GDZST3XVCDTUJ76ZAV2HA72KYRF5KKDTDQH2CBLFGEXU5PZC3T7KRMHQ',
  scopes: [],
};

function json(status: number, body: unknown = { message: 'unauthorized' }): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'content-type': 'application/json' },
  });
}

describe('401 session refresh', () => {
  it('triggers exactly one refresh and one retry', async () => {
    let token = 'stale';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const onUnauthorized = vi.fn(async () => {
      token = 'fresh';
      return { token };
    });
    const http = new HttpClient({
      baseUrl: 'https://api.example',
      token: () => token,
      onUnauthorized,
      fetch: fetchMock,
      timeoutMs: 1_000,
    });

    await expect(http.get('/me')).resolves.toEqual({ ok: true });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer fresh' }),
      }),
    );
  });

  it('shares one refresh call across concurrent 401s', async () => {
    let calls = 0;
    let release: (value: { token: string }) => void = () => {};
    const refreshGate = new Promise<{ token: string }>((resolve) => {
      release = resolve;
    });
    const onUnauthorized = vi.fn(() => refreshGate);
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls <= 2 ? json(401) : json(200, { ok: true });
    });
    const http = new HttpClient({
      baseUrl: 'https://api.example',
      token: 'stale',
      onUnauthorized,
      fetch: fetchMock,
      timeoutMs: 1_000,
    });

    const pending = Promise.all([http.get('/a'), http.get('/b')]);
    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    release({ token: 'fresh' });

    await expect(pending).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('clears the session when refresh fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) return json(401, { message: 'refresh rejected' });
      return json(401, { message: 'expired' });
    });
    const onSession = vi.fn();
    const client = new DukaPayClient({
      baseUrl: 'https://api.example',
      onSession,
      http: { fetch: fetchMock, timeoutMs: 1_000 },
    });
    client.setSession(SESSION);

    await expect(client.http.get('/me')).rejects.toBeInstanceOf(DukaPayError);
    expect(client.getSession()).toBeNull();
    expect(onSession).toHaveBeenCalledWith(null);
  });

  it('does not hang when /auth/refresh itself returns 401', async () => {
    const fetchMock = vi.fn(async () => json(401, { message: 'refresh rejected' }));
    const client = new DukaPayClient({
      baseUrl: 'https://api.example',
      http: { fetch: fetchMock, timeoutMs: 5_000 },
    });
    client.setSession(SESSION);

    const outcome = await Promise.race([
      client.http.get('/me').then(
        () => 'resolved',
        (error: unknown) => error,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 400)),
    ]);

    expect(outcome).not.toBe('hung');
    expect(outcome).toBeInstanceOf(DukaPayError);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining([expect.stringContaining('/auth/refresh')]),
    );
    const refreshCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });
});
