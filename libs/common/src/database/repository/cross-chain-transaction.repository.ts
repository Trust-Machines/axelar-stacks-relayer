import { Injectable } from '@nestjs/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';
import { CrossChainTransaction } from '@prisma/client';

@Injectable()
export class CrossChainTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(txHashes: string[]) {
    await this.prisma.crossChainTransaction.createMany({
      data: txHashes.map((txHash) => ({
        txHash,
        burnBlockHeight: null,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Process up to `${take}` transactions from the database that have been finalized or finality information is not set yet. Runs logic in a database transaction, commiting everything after
   * the batch has been processed.
   * Uses Postgres `FOR UPDATE SKIP LOCKED`, which allows multiple consumers running in parallel without being blocked.
   * Deletes successfully processed items at the end of the database transaction. Unsuccessful entries can be retried.
   */
  processPending(
    doProcessing: (crossChainTransactions: CrossChainTransaction[]) => Promise<{
      processedTxs: string[];
      updatedTxs: CrossChainTransaction[];
    }>,
    finalizedBurnBlockHeight: number,
    take: number = 10,
    timeout: number = 60_000,
  ): Promise<string[]> {
    return this.prisma.$transaction(
      async (tx) => {
        const result = await tx.$queryRaw<CrossChainTransaction[]>`
          SELECT *
          from "CrossChainTransaction"
          WHERE "burnBlockHeight" is NULL
             OR "burnBlockHeight" <= ${finalizedBurnBlockHeight}
          ORDER BY "createdAt" ASC
            FOR
              UPDATE SKIP LOCKED LIMIT ${take}
        `;

        if (result.length === 0) {
          return [];
        }

        const { processedTxs, updatedTxs } = await doProcessing(result);

        if (updatedTxs.length > 0) {
          for (const updatedTx of updatedTxs) {
            await tx.crossChainTransaction.update({
              where: {
                txHash: updatedTx.txHash,
              },
              data: {
                burnBlockHeight: updatedTx.burnBlockHeight,
              },
              select: null,
            });
          }
        }

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

        return [...processedTxs, ...updatedTxs.map(updatedTx => updatedTx.txHash)];
      },
      {
        timeout,
      },
    );
  }
}
