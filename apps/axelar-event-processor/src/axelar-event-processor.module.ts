import { Module } from '@nestjs/common';
import { ApprovalsProcessorModule } from './approvals-processor';

@Module({
  imports: [ApprovalsProcessorModule],
})
export class AxelarEventProcessorModule {}
