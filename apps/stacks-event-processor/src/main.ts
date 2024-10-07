import { NestFactory } from '@nestjs/core';
import { StacksEventProcessorModule } from './stacks-event-processor.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(StacksEventProcessorModule);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
