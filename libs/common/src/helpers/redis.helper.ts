import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT_TOKEN } from '../utils';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

@Injectable()
export class RedisHelper {
  private readonly logger: Logger;

  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    private readonly slackApi: SlackApi,
  ) {
    this.logger = new Logger(RedisHelper.name);
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const data = await this.redis.get(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('RedisCache - An error occurred while trying to get from redis cache.', {
          cacheKey: key,
          error: error?.toString(),
        });
        await this.slackApi.sendError('Redis error', 'An error occurred while trying to get from redis cache.');
      }
    }
    return undefined;
  }

  async scan(pattern: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const reply = await this.redis.scan(cursor, 'MATCH', pattern);

      cursor = reply[0];
      found.push(...reply[1]);
    } while (cursor !== '0');

    return found;
  }

  async delete(...keys: string[]): Promise<void> {
    try {
      await this.redis.del(keys);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('RedisCache - An error occurred while trying to delete from redis cache.', {
          cacheKey: keys.join(','),
          error: error?.toString(),
        });
        await this.slackApi.sendError('Redis error', 'An error occurred while trying to delete from redis cache.');
      }
    }
  }

  async set<T>(key: string, value: T, ttl: number | null = null, cacheNullable: boolean = true): Promise<void> {
    if (value === undefined) {
      return;
    }

    if (!cacheNullable && value == null) {
      return;
    }

    if (typeof ttl === 'number' && ttl <= 0) {
      return;
    }

    try {
      if (!ttl) {
        await this.redis.set(key, JSON.stringify(value));
      } else {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
      }
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('RedisCache - An error occurred while trying to set in redis cache.', {
          cacheKey: key,
          error: error?.toString(),
        });
        await this.slackApi.sendError('Redis error', 'An error occurred while trying to set redis cache.');
      }
    }
  }

  async incrby(key: string, value: number | string): Promise<number> {
    try {
      return await this.redis.incrby(key, value);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('RedisCache - An error occurred while trying to incrby redis key.', {
          cacheKey: key,
          error: error?.toString(),
        });
        await this.slackApi.sendError('Redis error', 'An error occurred while trying to incrby redis cache.');
      }
      throw error;
    }
  }

  async decrby(key: string, value: number | string): Promise<number> {
    try {
      return await this.redis.decrby(key, value);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('RedisCache - An error occurred while trying to decrby redis key.', {
          cacheKey: key,
          error: error.toString(),
        });
        await this.slackApi.sendError('Redis error', 'An error occurred while trying to decrby redis cache.');
      }
      throw error;
    }
  }
}
