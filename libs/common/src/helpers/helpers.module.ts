import { forwardRef, Module } from '@nestjs/common';
import { ApiConfigModule, DynamicModuleUtils } from '@stacks-monorepo/common';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { HiroApiHelper } from './hiro.api.helpers';

@Module({
  imports: [forwardRef(() => DynamicModuleUtils.getRedisModule()), ApiConfigModule],
  providers: [RedisHelper, HiroApiHelper],
  exports: [RedisHelper, HiroApiHelper],
})
export class HelpersModule {}
