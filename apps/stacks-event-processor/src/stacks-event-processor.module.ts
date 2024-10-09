import { Module } from '@nestjs/common';
import { EventProcessorModule } from './event-processor';
import { MessageApprovedProcessorModule } from './message-approved-processor';
import { CrossChainTransactionProcessorModule } from './cross-chain-transaction-processor';

@Module({
  imports: [EventProcessorModule, MessageApprovedProcessorModule, CrossChainTransactionProcessorModule],
})
export class StacksEventProcessorModule {}
