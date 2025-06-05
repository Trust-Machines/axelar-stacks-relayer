import { Module } from '@nestjs/common';
import { VerifyMessageCommand } from './verify-message.command';
import { ApiConfigModule, ApiModule } from '@stacks-monorepo/common';
import { ProcessorsModule } from '../apps/stacks-event-processor/src/cross-chain-transaction-processor/processors';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { CosmwasmService } from '../apps/axelar-event-processor/src/approvals-processor/cosmwasm.service';

@Module({
  imports: [ApiConfigModule, ProcessorsModule, HelpersModule, ApiModule], // TODO: Manually configure providers instead
  providers: [VerifyMessageCommand, CosmwasmService],
})
export class CommandsModule {}
