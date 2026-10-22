import { createClient, type RedisClientType } from 'redis';
import logger from '../utils/logger.js';
import { env } from '../config/env.js';

let sharedClient: RedisClientType | null = null;

export function getRedisClient(): RedisClientType {
  if (!sharedClient) {
    sharedClient = createClient({
      url: env.REDIS_URL,
    });

    sharedClient.on('error', (err: { code?: string }) => {
      if (env.NODE_ENV !== 'test' || err.code !== 'ECONNREFUSED') {
        logger.withContext().error('Redis Client Error', err);
      }
    });

    sharedClient.on('connect', () => {
      logger.withContext().info('Redis Client Connected');
    });

    sharedClient.on('reconnecting', () => {
      if (env.NODE_ENV !== 'test') {
        logger.withContext().info('Redis Client Reconnecting');
      }
    });
  }

  return sharedClient;
}

export type { RedisClientType };
