import { NestFactory } from '@nestjs/core';
import { StacksTransactionProcessorModule } from './stacks-transaction-processor.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(StacksTransactionProcessorModule);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
