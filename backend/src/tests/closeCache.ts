import { afterAll } from '@jest/globals';

// A cache client left open keeps reconnecting to Redis and Jest never exits.
// Suites that mock cacheService get the mock here, which has no close().
afterAll(async () => {
  const { cacheService } = await import('../services/cacheService.js');
  await cacheService.close?.();
  const { closeRedisClient } = await import('../services/redisClient.js');
  await closeRedisClient?.();
});
