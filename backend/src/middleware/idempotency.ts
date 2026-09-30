import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { cacheService } from '../services/cacheService.js';
import logger from '../utils/logger.js';

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds
const IDEMPOTENCY_LOCK_TTL = IDEMPOTENCY_TTL;

interface CachedResponse {
  status: number;
  body: unknown;
}

/**
 * Circuit breaker for Redis operations in idempotency middleware.
 * Trips when consecutive failures exceed threshold to avoid cascading timeouts.
 */
export class IdempotencyCircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetTimeoutMs: number;

  constructor(threshold = 3, resetTimeoutMs = 30_000) {
    this.threshold = threshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  isOpen(): boolean {
    if (this.failureCount >= this.threshold) {
      const now = Date.now();
      if (now - this.lastFailureTime < this.resetTimeoutMs) {
        return true;
      }
      // Half-open: allow a single attempt through after timeout
      return false;
    }
    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
  }

  recordFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
  }

  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  getFailures(): number {
    return this.failureCount;
  }
}

export const idempotencyCircuitBreaker = new IdempotencyCircuitBreaker();

/**
 * Middleware to handle Idempotency-Key headers.
 * If the key is present and a cached response exists, it returns the cached response.
 * Otherwise, it intercepts the response, captures it, and stores it in Redis.
 * If Redis is unavailable or fails, returns 503 Service Unavailable to prevent duplicate execution.
 */
export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const key = req.header('Idempotency-Key');

  if (!key) {
    return next();
  }

  // Check circuit breaker before attempting Redis access
  if (idempotencyCircuitBreaker.isOpen()) {
    logger.error('Alert: Idempotency circuit breaker is open, rejecting request with 503', {
      key,
      url: req.originalUrl,
      method: req.method,
      consecutiveFailures: idempotencyCircuitBreaker.getFailures(),
    });
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Idempotency service temporarily unavailable. Please retry later.',
    });
    return;
  }

  try {
    const user = (req as Request & { user?: { publicKey?: string } }).user;
    const principal = user?.publicKey ? `user:${user.publicKey}` : `ip:${req.ip || 'unknown'}`;
    const route = `${req.baseUrl || ''}${req.path || req.originalUrl}`;
    const scope = `${principal}:${req.method}:${route}`;
    const cacheKey = `idemp:${scope}:${key}`;
    const lockKey = `${cacheKey}:inflight`;
    const cached = await cacheService.get<CachedResponse>(cacheKey);

    idempotencyCircuitBreaker.recordSuccess();

    if (cached) {
      logger.info(`Idempotency hit for key: ${key}`, {
        url: req.originalUrl,
        method: req.method,
      });

      // X-Idempotent-Replayed: true signals to the client that this response
      // is a cached replay of a prior request, not a fresh execution.
      res
        .status(cached.status)
        .set('X-Idempotency-Cache', 'HIT')
        .set('X-Idempotent-Replayed', 'true')
        .json(cached.body);
      return;
    }

    const lockToken = randomUUID();
    const acquired = await cacheService.reserve(lockKey, lockToken, IDEMPOTENCY_LOCK_TTL);
    if (!acquired) {
      // The first lookup can race with another request finishing and releasing
      // its lock. Re-read the response before returning an in-flight conflict.
      const completed = await cacheService.get<CachedResponse>(cacheKey);
      if (completed) {
        res
          .status(completed.status)
          .set('X-Idempotency-Cache', 'HIT')
          .set('X-Idempotent-Replayed', 'true')
          .json(completed.body);
        return;
      }
      res.status(409).json({
        error: 'Conflict',
        message: 'A request with this idempotency key is already in progress.',
      });
      return;
    }

    // A request may have completed between the first cache read and lock
    // acquisition. Return that result and release our otherwise redundant lock.
    const completed = await cacheService.get<CachedResponse>(cacheKey);
    if (completed) {
      await cacheService.deleteIfMatch(lockKey, lockToken);
      res
        .status(completed.status)
        .set('X-Idempotency-Cache', 'HIT')
        .set('X-Idempotent-Replayed', 'true')
        .json(completed.body);
      return;
    }

    // Capture the original methods to intercept the response body
    const originalJson = res.json;
    const originalSend = res.send;

    let responseBody: unknown;

    // Override res.json
    res.json = function (body: unknown) {
      responseBody = body;
      return originalJson.call(this, body);
    };

    // Override res.send (as res.json eventually calls res.send)
    res.send = function (body: unknown) {
      if (!responseBody) {
        if (typeof body === 'string') {
          try {
            responseBody = JSON.parse(body);
          } catch {
            responseBody = body;
          }
        } else {
          responseBody = body;
        }
      }
      return originalSend.call(this, body);
    };

    // X-Idempotent-Replayed: false on the first (fresh) execution so the
    // client always receives the header and can branch on its value.
    res.set('X-Idempotent-Replayed', 'false');

    // Store the response in cache once the request is finished
    res.on('finish', async () => {
      // Only cache 2xx and 4xx status codes.
      // 5xx errors should usually be retried without returning a cached failure.
      const cacheable = res.statusCode >= 200 && res.statusCode < 500 && responseBody !== undefined;
      let responseStored = false;
      if (cacheable) {
        try {
          await cacheService.setRequired(
            cacheKey,
            {
              status: res.statusCode,
              body: responseBody,
            },
            IDEMPOTENCY_TTL,
          );
          idempotencyCircuitBreaker.recordSuccess();
          responseStored = true;
        } catch (error) {
          idempotencyCircuitBreaker.recordFailure();
          logger.error(`Alert: Error caching idempotency key in Redis: ${key}`, {
            error: error instanceof Error ? error.message : String(error),
            key,
          });
        }
      }
      // Keep the reservation if saving the successful response failed: letting
      // a retry execute again would defeat idempotency. It expires with the
      // response TTL. Non-cacheable failures can be retried immediately.
      if (responseStored || !cacheable) {
        await cacheService.deleteIfMatch(lockKey, lockToken);
      }
    });

    next();
  } catch (error) {
    idempotencyCircuitBreaker.recordFailure();
    logger.error('Alert: Redis failure in idempotency middleware', {
      error: error instanceof Error ? error.message : String(error),
      key,
      url: req.originalUrl,
      method: req.method,
    });
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Idempotency service temporarily unavailable. Please retry later.',
    });
  }
};
