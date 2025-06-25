import { Module } from '@nestjs/common';
import { ApprovalsProcessorModule } from './approvals-processor';
import { TransactionsProcessorModule } from './transactions-processor/transactions.processor.module';

@Module({
  imports: [ApprovalsProcessorModule, TransactionsProcessorModule],
})
export class AxelarEventProcessorModule {}
