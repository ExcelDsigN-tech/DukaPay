import { Request, Response, NextFunction } from 'express';
import { idempotencyMiddleware, idempotencyCircuitBreaker } from '../middleware/idempotency.js';
import { cacheService } from '../services/cacheService.js';
import { jest } from '@jest/globals';

// Helper to cast to jest.Mock
const asMock = (fn: unknown) => fn as jest.Mock;

describe('Idempotency Middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    idempotencyCircuitBreaker.reset();
    req = {
      header: jest.fn() as unknown as Request['header'],
      method: 'POST',
      originalUrl: '/api/test',
      baseUrl: '/api',
      path: '/test',
      ip: '127.0.0.1',
      user: { publicKey: 'GUSER1' },
    };
    res = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      set: jest.fn().mockReturnThis() as unknown as Response['set'],
      json: jest.fn().mockReturnThis() as unknown as Response['json'],
      send: jest.fn().mockReturnThis() as unknown as Response['send'],
      on: jest.fn() as unknown as Response['on'],
      statusCode: 200,
    };
    next = jest.fn();

    jest.spyOn(cacheService, 'get').mockReset();
    jest.spyOn(cacheService, 'set').mockReset();
    jest.spyOn(cacheService, 'reserve').mockReset().mockResolvedValue(true);
    jest.spyOn(cacheService, 'setRequired').mockReset().mockResolvedValue(undefined);
    jest.spyOn(cacheService, 'deleteIfMatch').mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should call next() if no Idempotency-Key is present', async () => {
    asMock(req.header).mockReturnValue(undefined);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
  });

  it('should return cached response if key exists', async () => {
    const key = 'test-key';
    const cachedResponse = { status: 201, body: { success: true } };
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cachedResponse);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(cacheService.get).toHaveBeenCalledWith(`idemp:user:GUSER1:POST:/api/test:${key}`);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.set).toHaveBeenCalledWith('X-Idempotency-Cache', 'HIT');
    expect(res.json).toHaveBeenCalledWith(cachedResponse.body);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets X-Idempotent-Replayed: true on a cache hit (replayed response)', async () => {
    const key = 'replay-key';
    const cachedResponse = { status: 200, body: { id: 99 } };
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cachedResponse);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'true');
    expect(next).not.toHaveBeenCalled();
  });

  it('sets X-Idempotent-Replayed: false on a fresh (cache miss) execution', async () => {
    const key = 'fresh-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'false');
    expect(next).toHaveBeenCalled();
  });

  it('should proceed and intercept response on cache miss', async () => {
    const key = 'new-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(cacheService.reserve).toHaveBeenCalledWith(
      `idemp:user:GUSER1:POST:/api/test:${key}:inflight`,
      expect.any(String),
      24 * 60 * 60,
    );
  });

  it('returns 409 when another request already holds the scoped in-flight lock', async () => {
    const key = 'busy-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (cacheService.reserve as jest.Mock<() => Promise<boolean>>).mockResolvedValue(false);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });

  it('only allows one concurrent request with a scoped key to reach the handler', async () => {
    let reserved = false;
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (cacheService.reserve as jest.Mock<() => Promise<boolean>>).mockImplementation(async () => {
      if (reserved) return false;
      reserved = true;
      return true;
    });

    const makeRequest = () =>
      ({
        ...req,
        header: jest.fn().mockReturnValue('concurrent-key'),
      }) as unknown as Request;
    const makeResponse = () =>
      ({
        status: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        on: jest.fn(),
        statusCode: 200,
      }) as unknown as Response;
    const firstNext = jest.fn();
    const secondNext = jest.fn();
    const firstResponse = makeResponse();
    const secondResponse = makeResponse();

    await Promise.all([
      idempotencyMiddleware(makeRequest(), firstResponse, firstNext),
      idempotencyMiddleware(makeRequest(), secondResponse, secondNext),
    ]);

    expect(firstNext.mock.calls.length + secondNext.mock.calls.length).toBe(1);
    expect(
      [firstResponse, secondResponse].some((response) =>
        (response.status as jest.Mock).mock.calls.some(([status]) => status === 409),
      ),
    ).toBe(true);
  });

  it('scopes cache and reservation keys by principal, method, and route', async () => {
    asMock(req.header).mockReturnValue('shared-key');
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (req as Request & { user?: { publicKey: string } }).user = { publicKey: 'GUSER2' };

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(cacheService.get).toHaveBeenCalledWith('idemp:user:GUSER2:POST:/api/test:shared-key');
    expect(cacheService.reserve).toHaveBeenCalledWith(
      'idemp:user:GUSER2:POST:/api/test:shared-key:inflight',
      expect.any(String),
      24 * 60 * 60,
    );
  });

  it('should return 503 Service Unavailable when Redis fails on get', async () => {
    const key = 'error-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockRejectedValue(
      new Error('Redis connection error'),
    );

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Service Unavailable',
      message: 'Idempotency service temporarily unavailable. Please retry later.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject with 503 when circuit breaker is open', async () => {
    const key = 'circuit-key';
    asMock(req.header).mockReturnValue(key);

    // Trip the circuit breaker by recording failures
    idempotencyCircuitBreaker.recordFailure();
    idempotencyCircuitBreaker.recordFailure();
    idempotencyCircuitBreaker.recordFailure();
    expect(idempotencyCircuitBreaker.isOpen()).toBe(true);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Service Unavailable',
      message: 'Idempotency service temporarily unavailable. Please retry later.',
    });
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
