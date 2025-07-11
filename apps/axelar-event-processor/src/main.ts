import { NestFactory } from '@nestjs/core';
import { AxelarEventProcessorModule } from './axelar-event-processor.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(AxelarEventProcessorModule);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
