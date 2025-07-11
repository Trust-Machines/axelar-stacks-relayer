import { Injectable } from '@nestjs/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';
import { MessageApproved, MessageApprovedStatus, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

@Injectable()
export class MessageApprovedRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createOrUpdate(data: Prisma.MessageApprovedCreateInput) {
    await this.prisma.messageApproved.upsert({
      where: {
        sourceChain_messageId: {
          sourceChain: data.sourceChain,
          messageId: data.messageId,
        },
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
    doProcessing: (items: MessageApproved[]) => Promise<MessageApproved[]>,
    take: number = 10,
    timeout: number = 60_000,
  ): Promise<MessageApproved[]> {
    // Last updated more than three minutes ago, if retrying
    const lastUpdatedAtRetry = new Date(new Date().getTime() - 180_000);
    // Prevent frequent retries of special transactions
    const lastUpdated = new Date(new Date().getTime() - 15_000);

    return this.prisma.$transaction(
      async (tx) => {
        // New entries have priority over older ones
        const result = await tx.$queryRaw<MessageApproved[]>`
          SELECT *
          from "MessageApproved"
          WHERE "status" = ${MessageApprovedStatus.PENDING}::"MessageApprovedStatus" AND (("retry" = 0 AND ("createdAt" = "updatedAt" OR "updatedAt" < ${lastUpdated}))
             OR "updatedAt"
              < ${lastUpdatedAtRetry})
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
              tx.messageApproved.update({
                where: {
                  sourceChain_messageId: {
                    sourceChain: data.sourceChain,
                    messageId: data.messageId,
                  },
                },
                data: {
                  status: data.status,
                  retry: data.retry,
                  executeTxHash: data.executeTxHash,
                  // @ts-ignore
                  extraData: data.extraData,
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

  async updateStatusIfItExists(sourceChain: string, messageId: string, status: MessageApprovedStatus) {
    try {
      await this.prisma.messageApproved.update({
        where: {
          sourceChain_messageId: {
            sourceChain,
            messageId,
          },
        },
        data: {
          status,
        },
      });

      return true;
    } catch (e) {
      // In case record was not found
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        return false;
      }

      throw e;
    }
  }
}
