import { Module } from '@nestjs/common';
import { CrossChainTransactionProcessorModule } from './cross-chain-transaction-processor';
import { MessageApprovedProcessorModule } from './message-approved-processor';
import { StacksTransactionProcessorModule } from './stacks-transaction-processor/stacks-transaction.processor.module';

@Module({
  imports: [CrossChainTransactionProcessorModule, MessageApprovedProcessorModule, StacksTransactionProcessorModule],
})
export class StacksScalableProcessorsModule {}
