import { DynamicModule } from '@nestjs/common';
import Redis from 'ioredis';
import { ApiConfigService } from '../config';

export const REDIS_CLIENT_TOKEN = 'REDIS_CLIENT_TOKEN';
export class DynamicModuleUtils {
  static getRedisModule(): DynamicModule {
    return {
      module: DynamicModuleUtils,
      providers: [
        {
          provide: REDIS_CLIENT_TOKEN,
          useFactory: (apiConfigService: ApiConfigService) => {
            return new Redis(apiConfigService.getRedisUrl());
          },
          inject: [ApiConfigService],
        },
      ],
      exports: [REDIS_CLIENT_TOKEN],
    };
  }
}
