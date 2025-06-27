import { NestFactory } from '@nestjs/core';
import { StacksScalableProcessorsModule } from './stacks-scalable-processors.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(StacksScalableProcessorsModule);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
