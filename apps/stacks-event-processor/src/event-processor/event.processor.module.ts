import { ApiConfigModule } from '@mvx-monorepo/common';
import { HelpersModule } from '@mvx-monorepo/common/helpers/helpers.module';
import { Module } from '@nestjs/common';
import { EventProcessorService } from './event.processor.service';

@Module({
  imports: [ApiConfigModule, HelpersModule],
  providers: [EventProcessorService],
})
export class EventProcessorModule {}
