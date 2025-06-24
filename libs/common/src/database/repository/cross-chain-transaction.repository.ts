import { Injectable } from '@nestjs/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';

@Injectable()
export class CrossChainTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(txHashes: string[]) {
    await this.prisma.crossChainTransaction.createMany({
      data: txHashes.map((txHash) => ({
        txHash,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Process up to `${take}` items from the database. Runs logic in a database transaction, commiting everything after
   * the batch has been processed.
   * Uses Postgres `FOR UPDATE SKIP LOCKED`, which allows multiple consumers running in parallel without being blocked.
   * Deletes successfully processed items at the end of the database transaction. Unsuccessful entries can be retried.
   */
  processPending(
    doProcessing: (txHashes: string[]) => Promise<string[]>,
    take: number = 10,
    timeout: number = 30_000,
  ): Promise<string[]> {
    return this.prisma.$transaction(
      async (tx) => {
        const result = await tx.$queryRaw<{ txHash: string }[]>`
          SELECT "txHash"
          from "CrossChainTransaction"
          ORDER BY "createdAt" ASC
            FOR
              UPDATE SKIP LOCKED LIMIT ${take}
        `;

        const txHashes = result.map((data) => data.txHash);

        if (txHashes.length === 0) {
          return [];
        }

        const processedTxs = await doProcessing(txHashes);

        // Only delete txs which have been successfully processed
        if (processedTxs.length > 0) {
          await tx.crossChainTransaction.deleteMany({
            where: {
              txHash: {
                in: processedTxs,
              },
            },
          });
        }

        return processedTxs;
      },
      {
        timeout,
      },
    );
  }
}
