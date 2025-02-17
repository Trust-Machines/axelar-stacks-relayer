import { Module } from '@nestjs/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { LastProcessedDataRepository } from '@stacks-monorepo/common/database/repository/last-processed-data.repository';

@Module({
  providers: [PrismaService, MessageApprovedRepository, LastProcessedDataRepository],
  exports: [MessageApprovedRepository, LastProcessedDataRepository],
})
export class DatabaseModule {}
