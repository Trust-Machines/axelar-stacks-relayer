import { ApiConfigModule, ApiModule, DatabaseModule } from '@stacks-monorepo/common';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { forwardRef, Module } from '@nestjs/common';
import { EventProcessorService } from './event.processor.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ApiConfigModule, HelpersModule, ScheduleModule.forRoot(), forwardRef(() => ApiModule), DatabaseModule],
  providers: [EventProcessorService],
})
export class EventProcessorModule {}
