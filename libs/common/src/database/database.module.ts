import { Module } from '@nestjs/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { LastProcessedDataRepository } from '@stacks-monorepo/common/database/repository/last-processed-data.repository';
import { CrossChainTransactionRepository } from '@stacks-monorepo/common/database/repository/cross-chain-transaction.repository';

@Module({
  providers: [PrismaService, MessageApprovedRepository, LastProcessedDataRepository, CrossChainTransactionRepository],
  exports: [MessageApprovedRepository, LastProcessedDataRepository, CrossChainTransactionRepository],
})
export class DatabaseModule {}
