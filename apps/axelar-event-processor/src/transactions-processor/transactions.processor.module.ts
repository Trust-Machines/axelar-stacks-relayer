import { forwardRef, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiConfigModule, ApiModule, ContractsModule, DatabaseModule } from '@stacks-monorepo/common';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { TransactionsProcessorService } from './transactions.processor.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ApiConfigModule,
    HelpersModule,
    forwardRef(() => ApiModule),
    ContractsModule,
    DatabaseModule,
  ],
  providers: [TransactionsProcessorService],
})
export class TransactionsProcessorModule {}
