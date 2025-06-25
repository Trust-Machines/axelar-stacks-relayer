import { Injectable } from '@nestjs/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';
import { Prisma, StacksTransaction, StacksTransactionStatus } from '@prisma/client';

@Injectable()
export class StacksTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createOrUpdate(data: Prisma.StacksTransactionCreateInput) {
    await this.prisma.stacksTransaction.upsert({
      where: {
        taskItemId: data.taskItemId,
      },
      update: data,
      create: data,
      select: null,
    });
  }

  /**
   * Process up to `${take}` items from the database. Runs logic in a database transaction, commiting everything after
   * the batch has been processed.
   * Uses Postgres `FOR UPDATE SKIP LOCKED`, which allows multiple consumers running in parallel without being blocked.
   * Updates successfully processed items at the end of the database transaction. Unsuccessful entries can be retried.
   */
  processPending(
    doProcessing: (items: StacksTransaction[]) => Promise<StacksTransaction[]>,
    take: number = 10,
    timeout: number = 60_000,
  ): Promise<StacksTransaction[]> {
    return this.prisma.$transaction(
      async (tx) => {
        const result = await tx.$queryRaw<StacksTransaction[]>`
          SELECT *
          from "StacksTransaction"
          WHERE "status" = ${StacksTransactionStatus.PENDING}::"StacksTransactionStatus"
          ORDER BY "retry" ASC, "createdAt" ASC
            FOR
              UPDATE SKIP LOCKED LIMIT ${take}
        `;

        if (result.length === 0) {
          return [];
        }

        const processedItems = await doProcessing(result);

        // Only update items which have been successfully processed
        if (processedItems.length > 0) {
          await Promise.all(
            processedItems.map((data) =>
              tx.stacksTransaction.update({
                where: {
                  taskItemId: data.taskItemId,
                },
                data: {
                  status: data.status,
                  retry: data.retry,
                  txHash: data.txHash,
                },
              }),
            ),
          );
        }

        return processedItems;
      },
      {
        timeout,
      },
    );
  }
}
