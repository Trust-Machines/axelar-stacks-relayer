import { forwardRef, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiConfigModule, ApiModule, DatabaseModule } from '@stacks-monorepo/common';
import { ContractsModule } from '@stacks-monorepo/common/contracts/contracts.module';
import { MessageApprovedProcessorService } from './message-approved.processor.service';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, ContractsModule, forwardRef(() => ApiModule), ApiConfigModule],
  providers: [MessageApprovedProcessorService],
})
export class MessageApprovedProcessorModule {}
