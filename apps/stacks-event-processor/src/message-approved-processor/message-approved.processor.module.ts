import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule, ApiModule } from '@stacks-monorepo/common';
import { ContractsModule } from '@stacks-monorepo/common/contracts/contracts.module';
import { MessageApprovedProcessorService } from './message-approved.processor.service';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, ContractsModule, ApiModule],
  providers: [MessageApprovedProcessorService],
})
export class MessageApprovedProcessorModule {}
