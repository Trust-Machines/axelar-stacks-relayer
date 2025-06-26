import { Module } from '@nestjs/common';
import { ApiConfigModule, ApiModule, ContractsModule, DatabaseModule } from '@stacks-monorepo/common';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { StacksService } from './services/stacks.service';
import { AxelarService } from './services/axelar.service';
import { ItsHubExecuteCommand } from './its-hub-execute.command';
import { StacksExecute } from './stacks-execute.command';
import { StacksGatewayCommand } from './stacks-gateway.command';
import { GatewayProcessor } from '../apps/stacks-scalable-processors/src/cross-chain-transaction-processor/processors';

@Module({
  imports: [ApiConfigModule, HelpersModule, ApiModule, ContractsModule, DatabaseModule],
  providers: [
    StacksService,
    AxelarService,
    ItsHubExecuteCommand,
    StacksExecute,
    StacksGatewayCommand,
    GatewayProcessor,
  ],
})
export class CommandsModule {}
