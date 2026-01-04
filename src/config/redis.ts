import Redis from 'ioredis';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

let redis: Redis | null = null;
let subscriber: Redis | null = null;

export async function initRedis(): Promise<void> {
  redis = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redis.on('error', (error) => {
    logger.error({ error }, 'Redis error');
  });

  await redis.ping();
}

export function getRedis(): Redis {
  if (!redis) throw new Error('Redis not initialized');
  return redis;
}

export function getSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(config.redis.url, {
      tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
    });

    subscriber.on('connect', () => {
      logger.info('Redis subscriber connected');
    });

    subscriber.on('error', (error) => {
      logger.error({ error }, 'Redis subscriber error');
    });
  }
  return subscriber;
}

export async function publishTick(roundId: string, payload: object): Promise<void> {
  if (!redis) throw new Error('Redis not initialized');
  const channel = `arena:ticks:${roundId}`;
  await redis.publish(channel, JSON.stringify(payload));
  logger.debug(`Published tick to ${channel}`);
}

export async function publishAgentTick(roundId: string, agentId: string, payload: object): Promise<void> {
  if (!redis) throw new Error('Redis not initialized');
  const channel = `arena:ticks:${roundId}:${agentId}`;
  await redis.publish(channel, JSON.stringify(payload));
  logger.debug(`Published agent tick to ${channel}`);
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
  logger.info('Redis connections closed');
}
