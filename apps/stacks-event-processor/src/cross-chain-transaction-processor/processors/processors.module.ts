import { Module } from '@nestjs/common';
import { GatewayProcessor } from './gateway.processor';
import { ContractsModule } from '@stacks-monorepo/common/contracts/contracts.module';
import { DatabaseModule } from '@stacks-monorepo/common';
import { ApiModule } from '@stacks-monorepo/common/api/api.module';
import { GasServiceProcessor } from './gas-service.processor';
import { ItsProcessor } from './its.processor';

@Module({
  imports: [ContractsModule, DatabaseModule, ApiModule],
  providers: [GatewayProcessor, GasServiceProcessor, ItsProcessor],
  exports: [GatewayProcessor, GasServiceProcessor, ItsProcessor],
})
export class ProcessorsModule {}
