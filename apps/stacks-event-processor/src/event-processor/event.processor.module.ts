import { ApiConfigModule } from '@stacks-monorepo/common';
import { HelpersModule } from '@stacks-monorepo/common/helpers/helpers.module';
import { Module } from '@nestjs/common';
import { EventProcessorService } from './event.processor.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ApiConfigModule, HelpersModule, ScheduleModule.forRoot()],
  providers: [EventProcessorService],
})
export class EventProcessorModule {}
