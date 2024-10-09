import { DynamicModuleUtils } from '@stacks-monorepo/common';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { Module } from '@nestjs/common';

@Module({
  imports: [DynamicModuleUtils.getRedisModule()],
  providers: [RedisHelper],
  exports: [RedisHelper],
})
export class HelpersModule {}
