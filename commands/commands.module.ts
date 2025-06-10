import { Module } from '@nestjs/common';
import { VerifyMessageCommand } from './verify-message.command';
import { ApiConfigModule, ApiModule, ContractsModule } from '@stacks-monorepo/common';
import { ProcessorsModule } from '../apps/stacks-event-processor/src/cross-chain-transaction-processor/processors';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { CosmwasmService } from '../apps/axelar-event-processor/src/approvals-processor/cosmwasm.service';
import { StacksService } from './services/stacks.service';
import { AxelarService } from './services/axelar.service';
import { ItsHubExecuteCommand } from './its-hub-execute.command';
import { ConstructProofCommand } from './construct-proof.command';
import { StacksExecute } from './stacks-execute.command';

@Module({
  imports: [ApiConfigModule, ProcessorsModule, HelpersModule, ApiModule, ContractsModule],
  providers: [
    StacksService,
    AxelarService,
    CosmwasmService,
    VerifyMessageCommand,
    ItsHubExecuteCommand,
    ConstructProofCommand,
    StacksExecute,
  ],
})
export class CommandsModule {}
