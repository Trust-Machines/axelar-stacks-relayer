import { Module } from '@nestjs/common';
import { ApiConfigModule, ApiModule, ContractsModule } from '@stacks-monorepo/common';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { StacksService } from './services/stacks.service';
import { AxelarService } from './services/axelar.service';
import { ItsHubExecuteCommand } from './its-hub-execute.command';
import { StacksExecute } from './stacks-execute.command';
import { CosmwasmService } from './services/cosmwasm.service';

@Module({
  imports: [ApiConfigModule, HelpersModule, ApiModule, ContractsModule],
  providers: [StacksService, AxelarService, CosmwasmService, ItsHubExecuteCommand, StacksExecute],
})
export class CommandsModule {}
