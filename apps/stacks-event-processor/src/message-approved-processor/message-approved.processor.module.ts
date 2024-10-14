import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule, ApiModule, ApiConfigModule } from '@stacks-monorepo/common';
import { ContractsModule } from '@stacks-monorepo/common/contracts/contracts.module';
import { MessageApprovedProcessorService } from './message-approved.processor.service';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, ContractsModule, ApiModule, ApiConfigModule],
  providers: [MessageApprovedProcessorService],
})
export class MessageApprovedProcessorModule {}
