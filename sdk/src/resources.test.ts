import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from './http.js';
import { LoansResource, NotificationsResource, PoolResource, PrivacyResource } from './resources.js';

// Minimal valid Stellar G-address (56 chars starting with G)
const VALID_ADDR = 'G' + 'A'.repeat(55);
// A contract C-address (not a G-address) — invalid as a borrowerPublicKey
const CONTRACT_ADDR = 'C' + 'A'.repeat(55);

function makeHttp(mockFetch: ReturnType<typeof vi.fn>): HttpClient {
  return new HttpClient({ baseUrl: 'https://api.example.com', fetch: mockFetch });
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── LoansResource builders ────────────────────────────────────────────────────

describe('LoansResource.requestLoan', () => {
  it('posts to /loans/request with amount and borrowerPublicKey', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ id: 1 }));
    const loans = new LoansResource(makeHttp(mockFetch));

    await loans.requestLoan({ amount: '1000000', borrowerPublicKey: VALID_ADDR });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/loans/request');
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: '1000000',
      borrowerPublicKey: VALID_ADDR,
    });
  });
});

describe('LoansResource.buildDepositCollateral', () => {
  it('posts to /loans/:id/build-deposit-collateral', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'abc' }));
    const loans = new LoansResource(makeHttp(mockFetch));

    await loans.buildDepositCollateral(42, { amount: '500000', borrowerPublicKey: VALID_ADDR });

    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.pathname).toBe('/loans/42/build-deposit-collateral');
  });
});

describe('LoansResource.buildReleaseCollateral', () => {
  it('posts to /loans/:id/build-release-collateral', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'abc' }));
    const loans = new LoansResource(makeHttp(mockFetch));

    await loans.buildReleaseCollateral(7, { borrowerPublicKey: VALID_ADDR });

    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.pathname).toBe('/loans/7/build-release-collateral');
  });
});

describe('LoansResource.buildRefinance', () => {
  it('posts to /loans/:id/build-refinance', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'abc' }));
    const loans = new LoansResource(makeHttp(mockFetch));

    await loans.buildRefinance(3, {
      newAmount: '2000000',
      newTerm: 60,
      borrowerPublicKey: VALID_ADDR,
    });

    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/loans/3/build-refinance');
    expect(JSON.parse(init.body as string)).toMatchObject({ newAmount: '2000000', newTerm: 60 });
  });
});

describe('LoansResource.buildExtend', () => {
  it('posts to /loans/:id/build-extend', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'abc' }));
    const loans = new LoansResource(makeHttp(mockFetch));

    await loans.buildExtend(5, { extraLedgers: 1000, borrowerPublicKey: VALID_ADDR });

    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/loans/5/build-extend');
    expect(JSON.parse(init.body as string)).toMatchObject({ extraLedgers: 1000 });
  });
});

describe('LoansResource.contestDefault', () => {
  it('posts to /loans/:id/contest-default with reason', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ id: 9 }));
    const loans = new LoansResource(makeHttp(mockFetch));

    await loans.contestDefault(9, 'Repayment was sent on-chain but not reflected');

    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/loans/9/contest-default');
    expect(JSON.parse(init.body as string)).toMatchObject({
      reason: 'Repayment was sent on-chain but not reflected',
    });
  });

  it('throws immediately for an empty reason (no request sent)', async () => {
    const mockFetch = vi.fn();
    const loans = new LoansResource(makeHttp(mockFetch));

    await expect(loans.contestDefault(1, '')).rejects.toThrow('reason must be a non-empty string');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws immediately for a whitespace-only reason', async () => {
    const mockFetch = vi.fn();
    const loans = new LoansResource(makeHttp(mockFetch));

    await expect(loans.contestDefault(1, '   ')).rejects.toThrow('reason must be a non-empty string');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── PoolResource.buildEmergencyWithdraw ───────────────────────────────────────

describe('PoolResource.buildEmergencyWithdraw', () => {
  it('posts to /pool/build-emergency-withdraw', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ xdr: 'xyz' }));
    const pool = new PoolResource(makeHttp(mockFetch));

    await pool.buildEmergencyWithdraw({
      depositorPublicKey: VALID_ADDR,
      token: VALID_ADDR,
      shares: '100000',
    });

    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/pool/build-emergency-withdraw');
    expect(JSON.parse(init.body as string)).toMatchObject({
      depositorPublicKey: VALID_ADDR,
      shares: '100000',
    });
  });
});

// ── PrivacyResource validation ────────────────────────────────────────────────

describe('PrivacyResource', () => {
  it('requestAccess rejects a non-G... publicKey before sending a request', async () => {
    const mockFetch = vi.fn();
    const privacy = new PrivacyResource(makeHttp(mockFetch));

    await expect(
      privacy.requestAccess({ publicKey: CONTRACT_ADDR, reason: 'I need my data' }),
    ).rejects.toThrow('valid Stellar public key');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('export rejects a non-G... publicKey before sending a request', async () => {
    const mockFetch = vi.fn();
    const privacy = new PrivacyResource(makeHttp(mockFetch));

    await expect(privacy.export('not-a-key')).rejects.toThrow('valid Stellar public key');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('requestAccess posts to /privacy/dsar/access with a valid key', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ id: 'dsar-1', status: 'pending' }));
    const privacy = new PrivacyResource(makeHttp(mockFetch));

    await privacy.requestAccess({ publicKey: VALID_ADDR, reason: 'I need my data' });

    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.pathname).toBe('/privacy/dsar/access');
  });

  it('export GETs /privacy/export/:publicKey', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ publicKey: VALID_ADDR, data: {} }));
    const privacy = new PrivacyResource(makeHttp(mockFetch));

    await privacy.export(VALID_ADDR);

    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.pathname).toBe(`/privacy/export/${VALID_ADDR}`);
  });
});

// ── NotificationsResource.stream ─────────────────────────────────────────────

describe('NotificationsResource.stream', () => {
  function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
  }

  it('parses a single SSE event from the stream', async () => {
    const notification = { id: 'n1', type: 'loan_approved', read: false, payload: {}, createdAt: '' };
    const sseChunk = `id: evt1\nevent: notification\ndata: ${JSON.stringify(notification)}\n\n`;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(makeStream([sseChunk]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const notifs = new NotificationsResource(makeHttp(mockFetch));

    const received: unknown[] = [];
    await notifs.stream((evt) => received.push(evt));

    expect(received).toHaveLength(1);
    expect((received[0] as { id: string }).id).toBe('evt1');
    expect((received[0] as { event: string }).event).toBe('notification');
  });

  it('skips heartbeat/comment frames', async () => {
    const notification = { id: 'n2', type: 'score_updated', read: false, payload: {}, createdAt: '' };
    const sseChunk = `: heartbeat\n\ndata: ${JSON.stringify(notification)}\n\n`;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(makeStream([sseChunk]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const notifs = new NotificationsResource(makeHttp(mockFetch));

    const received: unknown[] = [];
    await notifs.stream((evt) => received.push(evt));

    expect(received).toHaveLength(1);
  });

  it('stops cleanly on AbortSignal without throwing', async () => {
    const ctrl = new AbortController();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
        // simulate abort before data arrives
        ctrl.abort();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const notifs = new NotificationsResource(makeHttp(mockFetch));

    await expect(notifs.stream(() => {}, { signal: ctrl.signal })).resolves.toBeUndefined();
  });

  it('throws for a non-200 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 401, statusText: 'Unauthorized' }),
    );
    const notifs = new NotificationsResource(makeHttp(mockFetch));

    await expect(notifs.stream(() => {})).rejects.toThrow('401');
  });
});
