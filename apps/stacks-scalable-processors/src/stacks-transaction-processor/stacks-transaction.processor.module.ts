import { forwardRef, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiConfigModule, ApiModule, ContractsModule, DatabaseModule } from '@stacks-monorepo/common';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { StacksTransactionProcessorService } from './stacks-transaction.processor.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ApiConfigModule,
    HelpersModule,
    forwardRef(() => ApiModule),
    ContractsModule,
    DatabaseModule,
  ],
  providers: [StacksTransactionProcessorService],
})
export class StacksTransactionProcessorModule {}
