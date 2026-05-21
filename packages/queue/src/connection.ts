import { Redis, type RedisOptions } from 'ioredis';
import { loadEnv } from '@claudegpt/shared';

let redis: Redis | null = null;

/**
 * Singleton Redis connection used by every queue and worker.
 * BullMQ requires `maxRetriesPerRequest: null` on the connection.
 */
export function getRedis(): Redis {
  if (!redis) {
    const env = loadEnv();
    const opts: RedisOptions = {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
    redis = new Redis(env.REDIS_URL, opts);
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
