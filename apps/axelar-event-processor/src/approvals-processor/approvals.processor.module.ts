import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiConfigModule, DatabaseModule } from '@stacks-monorepo/common';
import { ApiModule } from '@stacks-monorepo/common/api/api.module';
import { ContractsModule } from '@stacks-monorepo/common/contracts/contracts.module';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { ApprovalsProcessorService } from './approvals.processor.service';

@Module({
  imports: [ScheduleModule.forRoot(), ApiConfigModule, HelpersModule, ApiModule, ContractsModule, DatabaseModule],
  providers: [ApprovalsProcessorService],
})
export class ApprovalsProcessorModule {}
