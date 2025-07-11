import { forwardRef, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiConfigModule, DatabaseModule } from '@stacks-monorepo/common';
import { ApiModule } from '@stacks-monorepo/common/api/api.module';
import { ApprovalsProcessorService } from './approvals.processor.service';

@Module({
  imports: [ScheduleModule.forRoot(), ApiConfigModule, forwardRef(() => ApiModule), DatabaseModule],
  providers: [ApprovalsProcessorService],
})
export class ApprovalsProcessorModule {}
