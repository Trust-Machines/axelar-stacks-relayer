import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT_TOKEN } from '../utils';

@Injectable()
export class RedisHelper {
  private readonly logger: Logger;

  constructor(@Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis) {
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

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('RedisCache - An error occurred while trying to delete from redis cache.', {
          cacheKey: key,
          error: error?.toString(),
        });
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
      }
    }
  }

  async sadd(key: string, ...values: string[]): Promise<number | null> {
    try {
      return await this.redis.sadd(key, ...values);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('An error occurred while trying to sadd redis.', {
          exception: error?.toString(),
          key,
          ...values,
        });
      }
      throw error;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.redis.smembers(key);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('An error occurred while trying to smembers in redis.', {
          exception: error?.toString(),
          key,
        });
      }
      throw error;
    }
  }

  async srem(key: string, ...values: string[]) {
    try {
      return await this.redis.srem(key, ...values);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          'An error occurred while trying to srem redis.',
          Object.assign({
            exception: error === null || error === void 0 ? void 0 : error.toString(),
            key,
          }),
        );
      }
      throw error;
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
      }
      throw error;
    }
  }
}
