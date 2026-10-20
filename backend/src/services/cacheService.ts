import logger from '../utils/logger.js';
import {
  closeRedisClient,
  ensureRedisConnected,
  isRedisConnected,
  redisClient,
} from './redisClient.js';

class CacheService {
  /**
   * Set a value in the cache with an optional Time-To-Live (TTL).
   * @param key The cache key
   * @param value The value to cache (will be stringified)
   * @param ttlSeconds The TTL in seconds (default: 300 = 5 minutes)
   */
  async set(key: string, value: unknown, ttlSeconds: number = 300): Promise<void> {
    try {
      await ensureRedisConnected();
      const stringValue = JSON.stringify(value);
      await redisClient.setEx(key, ttlSeconds, stringValue);
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error setting cache for key ${key}`, { error });
      }
    }
  }

  /** Store a value or throw, for workflows that must not continue as if a
   * durable idempotency response had been saved when Redis rejected the write. */
  async setRequired(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await ensureRedisConnected();
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
  }

  /**
   * Get a value from the cache.
   * @param key The cache key
   * @returns The parsed value, or null if not found or error
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      await ensureRedisConnected();
      const value = await redisClient.get(key);
      if (!value) return null;

      return JSON.parse(value) as T;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error getting cache for key ${key}`, { error });
      }
      return null;
    }
  }

  /**
   * Set a value only if the key does not exist (SET NX - Set if Not Exists).
   * Used for distributed locking.
   * @param key The cache key
   * @param value The value to cache
   * @param ttlSeconds The TTL in seconds
   * @returns true if the key was set, false if the key already existed
   */
  async setNotExists(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    try {
      await ensureRedisConnected();
      if (!isRedisConnected()) return false;

      const stringValue = JSON.stringify(value);
      // SET key value NX EX ttlSeconds
      const result = await redisClient.set(key, stringValue, {
        NX: true,
        EX: ttlSeconds,
      });
      return result === 'OK';
    } catch (error) {
      logger.withContext().error(`Error setting NX cache for key ${key}`, { error });
      return false;
    }
  }

  /**
   * Atomically reserve a key, distinguishing an occupied key (`false`) from
   * a Redis failure (throws) so callers can fail closed rather than execute
   * a non-idempotent operation without its lock.
   */
  async reserve(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    await ensureRedisConnected();
    const result = await redisClient.set(key, JSON.stringify(value), {
      NX: true,
      EX: ttlSeconds,
    });
    return result === 'OK';
  }

  /**
   * Delete a value from the cache.
   * @param key The cache key
   */
  async delete(key: string): Promise<void> {
    try {
      await ensureRedisConnected();
      await redisClient.del(key);
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error deleting cache for key ${key}`, { error });
      }
    }
  }

  private static readonly COMPARE_AND_DELETE_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if stored == false then
  return 0
end
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

  /**
   * Delete a key only when its stored value matches `expectedValue` (fenced
   * compare-and-delete).  Used by distributed locks so a run that outlives the
   * TTL cannot delete a lock acquired by a different instance.
   *
   * The match-and-delete is performed atomically via a Lua script so that a
   * stale lock cannot be deleted between the read and the delete by a
   * different instance that re-acquired the lock in the window.
   *
   * @returns true if the key existed and the value matched (key deleted),
   *          false if the key was absent or the value did not match.
   */
  async deleteIfMatch(key: string, expectedValue: unknown): Promise<boolean> {
    try {
      await ensureRedisConnected();
      const result = await redisClient.eval(CacheService.COMPARE_AND_DELETE_SCRIPT, {
        keys: [key],
        arguments: [JSON.stringify(expectedValue)],
      });
      return result === 1;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error in deleteIfMatch for key ${key}`, { error });
      }
      return false;
    }
  }

  /**
   * Invalidate multiple keys by a pattern (e.g. prefix)
   * Note: KEYS is generally not recommended in production, but suitable for exact or bounded patterns.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      await ensureRedisConnected();
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error invalidating pattern ${pattern}`, { error });
      }
    }
  }

  /**
   * Ping the Redis server to verify connectivity.
   * Returns "ok" on success or "error" if unreachable.
   */
  async ping(): Promise<'ok' | 'error'> {
    try {
      await ensureRedisConnected();
      const reply = await redisClient.ping();
      return reply === 'PONG' ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }

  async close(): Promise<void> {
    await closeRedisClient();
  }
}

// Export a singleton instance
export const cacheService = new CacheService();
