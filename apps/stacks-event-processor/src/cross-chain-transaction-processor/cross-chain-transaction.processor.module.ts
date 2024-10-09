import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiConfigModule, ApiModule, ContractsModule, DatabaseModule } from '@stacks-monorepo/common';
import { CrossChainTransactionProcessorService } from './cross-chain-transaction.processor.service';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { ProcessorsModule } from './processors';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    ApiModule,
    HelpersModule,
    ContractsModule,
    ApiConfigModule,
    ProcessorsModule,
  ],
  providers: [CrossChainTransactionProcessorService],
})
export class CrossChainTransactionProcessorModule {}
