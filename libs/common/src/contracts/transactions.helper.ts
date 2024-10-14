import { Injectable, Logger } from '@nestjs/common';
import { broadcastTransaction, estimateContractFunctionCall, StacksTransaction } from '@stacks/transactions';
import { HiroApiHelper } from '../helpers/hiro.api.helpers';

@Injectable()
export class TransactionsHelper {
  private readonly logger: Logger;

  constructor(private readonly hiroApiHelper: HiroApiHelper) {
    this.logger = new Logger(TransactionsHelper.name);
  }

  async getTransactionGas(transaction: StacksTransaction, retry: number): Promise<bigint> {
    const result = await estimateContractFunctionCall(transaction);

    if (!result) {
      throw new Error(`Could not get gas for transaction ${transaction.txid()} ${JSON.stringify(result)}`);
    }

    // add 10% extra gas initially, and more gas with each retry
    const extraGasPercent = 10 + retry * 2;
    const extraGas = (result * BigInt(extraGasPercent)) / BigInt(100);

    return extraGas;
  }

  async sendTransaction(transaction: StacksTransaction): Promise<string> {
    const broadcastResponse = await broadcastTransaction(transaction);
    return broadcastResponse.txid;
  }

  async sendTransactions(transactions: any[]) {
    if (!transactions.length) {
      return [];
    }

    try {
      const hashes = await Promise.all(transactions.map((tx) => this.sendTransaction(tx)));

      this.logger.log(`Sent ${transactions.length} transactions to proxy: ${hashes}`);

      return hashes;
    } catch (e) {
      this.logger.error(`Can not send transactions to proxy...`);
      this.logger.error(e);

      return null;
    }
  }

  async awaitSuccess(txHash: string) {
    try {
      const result = await this.pollTransactionStatus(txHash);

      return result.tx_status === 'success';
    } catch (error) {
      this.logger.error(`Cannot await transaction success for txHash: ${txHash}`);
      this.logger.error(error);
      return false;
    }
  }

  private async pollTransactionStatus(txHash: string): Promise<any> {
    while (true) {
      try {
        const { transaction } = await this.hiroApiHelper.getTransactionWithFee(txHash);
        const status = transaction.tx_status as any;

        if (status !== 'pending') {
          return transaction;
        }

        await this.delay(6000);
      } catch (error) {
        throw new Error(`Error while polling transaction status: ${error}`);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
