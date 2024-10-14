import { Module } from '@nestjs/common';
import { ApiConfigModule, DatabaseModule, DynamicModuleUtils } from '@stacks-monorepo/common';
import { ApprovalsProcessorService } from './approvals.processor.service';
import { ApiModule } from '@stacks-monorepo/common/api/api.module';
import { ContractsModule } from '@stacks-monorepo/common/contracts/contracts.module';
import { ScheduleModule } from '@nestjs/schedule';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';

@Module({
  imports: [ScheduleModule.forRoot(), ApiConfigModule, HelpersModule, ApiModule, ContractsModule, DatabaseModule],
  providers: [ApprovalsProcessorService],
})
export class ApprovalsProcessorModule {}
