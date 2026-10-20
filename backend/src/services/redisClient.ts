import { createClient, type RedisClientType } from 'redis';
import logger from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient: RedisClientType = createClient({
  url: REDIS_URL,
});

let isConnected = false;

redisClient.on('error', (err) => {
  // In tests, we don't want to spam the console with ECONNREFUSED if Redis isn't running
  if (process.env.NODE_ENV !== 'test' || err.code !== 'ECONNREFUSED') {
    logger.withContext().error('Redis Client Error', err);
  }
  isConnected = false;
});

redisClient.on('connect', () => {
  logger.withContext().info('Redis Client Connected');
  isConnected = true;
});

redisClient.on('reconnecting', () => {
  // Only log reconnecting in non-test environments to keep test output clean
  if (process.env.NODE_ENV !== 'test') {
    logger.withContext().info('Redis Client Reconnecting');
  }
});

export async function ensureRedisConnected(): Promise<RedisClientType> {
  if (!isConnected) {
    try {
      await redisClient.connect();
      isConnected = true;
    } catch (err) {
      // Silently fail in tests if connection fails, but log in production
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error('Failed to connect to Redis', err);
      }
      throw err;
    }
  }
  return redisClient;
}

export function isRedisConnected(): boolean {
  return isConnected;
}

export async function closeRedisClient(): Promise<void> {
  if (!redisClient.isOpen) {
    isConnected = false;
    return;
  }
  // A client that never reached Redis is still open and retrying; quit()
  // would wait for it, so destroy() stops the reconnect loop instead.
  if (redisClient.isReady) {
    await redisClient.quit();
  } else {
    redisClient.destroy();
  }
  isConnected = false;
}
