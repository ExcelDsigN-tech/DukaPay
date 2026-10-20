import type { RedisClientType } from 'redis';
import logger from '../utils/logger.js';
import { ensureRedisConnected, redisClient } from './redisClient.js';

const CHANNEL = 'sse:events';

class PubSubService {
  private subClient: RedisClientType | null = null;

  async publish(event: unknown) {
    try {
      const client = await ensureRedisConnected();
      await client.publish(CHANNEL, JSON.stringify(event));
    } catch (err) {
      logger.withContext().error('Failed to publish SSE event to Redis', { err });
    }
  }

  async initSubscriber(onMessage: (payload: unknown) => void) {
    try {
      if (!this.subClient) {
        this.subClient = redisClient.duplicate();
        this.subClient.on('error', (err) =>
          logger.withContext().error('Redis sub client error', err),
        );
        await this.subClient.connect();
      }

      await this.subClient.subscribe(CHANNEL, (msg) => {
        try {
          const payload = JSON.parse(msg);
          onMessage(payload);
        } catch (e) {
          logger.withContext().error('Failed to parse pubsub message', { err: e });
        }
      });
    } catch (err) {
      logger.withContext().error('Failed to initialize Redis subscriber', { err });
    }
  }
}

export const pubsubService = new PubSubService();
