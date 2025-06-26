import { Injectable } from '@nestjs/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';
import { Prisma, StacksTransaction, StacksTransactionStatus, StacksTransactionType } from '@prisma/client';

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
    // Last updated more than two minutes ago, if retrying
    const lastUpdatedAtRetry = new Date(new Date().getTime() - 120_000);

    return this.prisma.$transaction(
      async (tx) => {
        // New entries have priority over older ones
        const result = await tx.$queryRaw<StacksTransaction[]>`
          SELECT *
          from "StacksTransaction"
          WHERE "status" = ${StacksTransactionStatus.PENDING}::"StacksTransactionStatus" AND ("retry" = 0 OR "updatedAt" < ${lastUpdatedAtRetry})
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

  findByTypeAndTxHash(type: StacksTransactionType, txHash: string) {
    return this.prisma.stacksTransaction.findFirst({
      where: {
        type,
        txHash,
      },
    });
  }

  async updateStatus(data: StacksTransaction) {
    await this.prisma.stacksTransaction.update({
      where: {
        taskItemId: data.taskItemId,
      },
      data: {
        status: data.status,
      },
    });
  }
}
