import { Module } from '@nestjs/common';
import { EventProcessorModule } from './event-processor';

@Module({
  imports: [EventProcessorModule],
})
export class StacksEventProcessorModule {}
