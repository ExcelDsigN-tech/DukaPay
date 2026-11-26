import { createClient, type RedisClientType } from 'redis';
import logger from '../utils/logger.js';
import { env } from '../config/env.js';

let sharedClient: RedisClientType | null = null;

export function getRedisClient(): RedisClientType {
  if (!sharedClient) {
    sharedClient = createClient({
      url: env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (env.NODE_ENV === 'test') {
            return false;
          }
          return Math.min(retries * 50, 3000);
        },
        connectTimeout: env.NODE_ENV === 'test' ? 1000 : 5000,
      },
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
