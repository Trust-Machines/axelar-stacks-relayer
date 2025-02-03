import { Injectable } from '@nestjs/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';
import { MessageApproved, MessageApprovedStatus, Prisma } from '@prisma/client';

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

  findPending(page: number = 0, take: number = 10): Promise<MessageApproved[] | null> {
    // Last updated more than six minutes ago, if retrying
    const lastUpdatedAtRetry = new Date(new Date().getTime() - 360_000);
    // Prevent frequent retries of special transactions
    const lastUpdated = new Date(new Date().getTime() - 15_000);

    return this.prisma.messageApproved.findMany({
      where: {
        status: MessageApprovedStatus.PENDING,
        OR: [
          {
            retry: 0,
            updatedAt: {
              lt: lastUpdated,
            },
          },
          {
            updatedAt: {
              lt: lastUpdatedAtRetry,
            },
          },
        ],
      },
      orderBy: [
        { retry: 'asc' }, // new entries have priority over older ones
        { createdAt: 'asc' },
      ],
      skip: page * take,
      take,
    });
  }

  findBySourceChainAndMessageId(sourceChain: string, messageId: string): Promise<MessageApproved | null> {
    return this.prisma.messageApproved.findUnique({
      where: {
        sourceChain_messageId: {
          sourceChain,
          messageId,
        },
      },
    });
  }

  async updateManyPartial(entries: MessageApproved[]) {
    await this.prisma.$transaction(
      entries.map((data) => {
        return this.prisma.messageApproved.update({
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
            successTimes: data.successTimes,
            // @ts-ignore
            extraData: data.extraData,
          },
        });
      }),
    );
  }

  async updateStatusAndSuccessTimes(data: MessageApproved) {
    await this.prisma.messageApproved.update({
      where: {
        sourceChain_messageId: {
          sourceChain: data.sourceChain,
          messageId: data.messageId,
        },
      },
      data: {
        status: data.status,
        successTimes: data.successTimes,
      },
    });
  }
}
