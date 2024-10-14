import { DynamicModuleUtils } from '@stacks-monorepo/common';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { Module } from '@nestjs/common';
import { HiroApiHelper } from './hiro.api.helpers';

@Module({
  imports: [DynamicModuleUtils.getRedisModule()],
  providers: [RedisHelper, HiroApiHelper],
  exports: [RedisHelper, HiroApiHelper],
})
export class HelpersModule {}
