import { Module } from '@nestjs/common';
import { TransactionProcessorModule } from './transaction-processor/transaction.processor.module';

@Module({
  imports: [TransactionProcessorModule],
})
export class StacksTransactionProcessorModule {}
