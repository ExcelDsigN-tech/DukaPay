import request from 'supertest';
import { jest } from '@jest/globals';
import { generateJwtToken } from '../services/authService.js';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const VALID_API_KEY = 'test-internal-key';
const LENDER_WALLET = 'GAAAALENDER123456789';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = VALID_API_KEY;
process.env.LENDER_WALLETS = LENDER_WALLET;

// ── DB mock (used by pool controller) ────────────────────────────────────────
const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();
jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

// ── notificationService mock ─────────────────────────────────────────────────
const mockGetNotificationsForUser = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockGetUnreadCount = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockSubscribe = jest.fn();
jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: {
    getNotificationsForUser: mockGetNotificationsForUser,
    getUnreadCount: mockGetUnreadCount,
    subscribe: mockSubscribe,
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
}));

// ── eventStreamService mock ──────────────────────────────────────────────────
const mockGetConnectionCount = jest.fn();
jest.unstable_mockModule('../services/eventStreamService.js', () => ({
  eventStreamService: {
    getConnectionCount: mockGetConnectionCount,
    subscribeBorrower: jest.fn(),
    subscribeAll: jest.fn(),
  },
}));

await import('../db/connection.js');
await import('../services/notificationService.js');
await import('../services/eventStreamService.js');
const { default: app } = await import('../app.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
  delete process.env.LENDER_WALLETS;
});

// ---------------------------------------------------------------------------
// /api route mounts
// ---------------------------------------------------------------------------
describe('/api route mounts', () => {
  it('GET /api/pool/stats returns 200 with lender auth', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ total_deposits: '10000' }],
      })
      .mockResolvedValueOnce({
        rows: [{ active_loans_count: '3', total_outstanding: '5000' }],
      });

    const response = await request(app).get('/api/pool/stats').set(bearer(LENDER_WALLET));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('GET /api/notifications returns 200 with borrower auth', async () => {
    mockGetNotificationsForUser.mockResolvedValueOnce([]);
    mockGetUnreadCount.mockResolvedValueOnce(0);

    const response = await request(app)
      .get('/api/notifications')
      .set(bearer('GAAABORROWER123456789'));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('GET /api/events/status returns 200 with API key', async () => {
    mockGetConnectionCount.mockReturnValueOnce({
      borrower: 0,
      admin: 0,
      total: 0,
    });

    const response = await request(app).get('/api/events/status').set('x-api-key', VALID_API_KEY);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it.each(['/api/privacy/dsar/abc-123', '/api/audit/proof/1', '/api/user/profile'])(
    'mounts %s under /api (rejects the unauthenticated request)',
    async (path) => {
      const response = await request(app).get(path);

      expect(response.status).toBe(401);
    },
  );

  it.each([
    '/api/v1/pool/stats',
    '/api/v1/privacy/dsar/abc-123',
    '/audit/proof/1',
    '/user/profile',
  ])('no longer mounts %s', async (path) => {
    const response = await request(app).get(path).set(bearer(LENDER_WALLET));

    expect(response.status).toBe(404);
  });
});
