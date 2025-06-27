import { Module } from '@nestjs/common';
import { CrossChainTransactionProcessorModule } from './cross-chain-transaction-processor';
import { MessageApprovedProcessorModule } from './message-approved-processor';

@Module({
  imports: [CrossChainTransactionProcessorModule, MessageApprovedProcessorModule],
})
export class StacksScalableProcessorsModule {}
