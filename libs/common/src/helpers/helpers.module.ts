import { DynamicModuleUtils } from '@mvx-monorepo/common';
import { RedisHelper } from '@mvx-monorepo/common/helpers/redis.helper';
import { Module } from '@nestjs/common';

@Module({
  imports: [DynamicModuleUtils.getRedisModule()],
  providers: [RedisHelper],
  exports: [RedisHelper],
})
export class HelpersModule {}
