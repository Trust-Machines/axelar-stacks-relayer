import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export const LAST_PROCESSED_DATA_TYPE = {
  LAST_TASK_ID: 'lastTaskUUID',

  LAST_PROCESSED_EVENT_GATEWAY: 'lastProcessedEvent:gateway',
  LAST_PROCESSED_EVENT_GAS_SERVICE: 'lastProcessedEvent:gas-service',
  LAST_PROCESSED_EVENT_ITS: 'lastProcessedEvent:its',
};

@Injectable()
export class LastProcessedDataRepository {
  constructor(private readonly prisma: PrismaService) {}

  async update(type: string, value: string) {
    await this.prisma.lastProcessedData.upsert({
      create: { type, value },
      where: { type },
      update: { value },
      select: null,
    });
  }

  async get(type: string): Promise<string | undefined> {
    const entry = await this.prisma.lastProcessedData.findUnique({
      where: { type },
    });

    return entry?.value ?? undefined;
  }
}
