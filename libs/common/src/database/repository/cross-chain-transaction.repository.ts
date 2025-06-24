import { Injectable } from '@nestjs/common';
import { PrismaService } from '@stacks-monorepo/common/database/prisma.service';
import { CrossChainTransactionStatus } from '@prisma/client';

@Injectable()
export class CrossChainTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(txHashes: string[]) {
    await this.prisma.crossChainTransaction.createMany({
      data: txHashes.map((txHash) => ({
        txHash,
        status: CrossChainTransactionStatus.PENDING,
      })),
      skipDuplicates: true,
    });
  }

  async findPending(page: number = 0, take: number = 10): Promise<string[]> {
    const result = await this.prisma.crossChainTransaction.findMany({
      where: {
        status: CrossChainTransactionStatus.PENDING,
      },
      orderBy: [{ createdAt: 'asc' }],
      skip: page * take,
      take,
      select: {
        txHash: true,
      },
    });

    return result.map((data) => data.txHash);
  }

  async markAsSuccess(txHash: string) {
    await this.prisma.crossChainTransaction.update({
      where: {
        txHash,
      },
      data: {
        status: CrossChainTransactionStatus.SUCCESS,
      },
    });
  }
}
