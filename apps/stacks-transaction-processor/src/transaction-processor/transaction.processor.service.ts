import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StacksTransaction, StacksTransactionStatus, StacksTransactionType } from '@prisma/client';
import { BinaryUtils, CacheInfo, GasServiceContract, Locker } from '@stacks-monorepo/common';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { DecodingUtils, gatewayTxDataDecoder } from '@stacks-monorepo/common/utils/decoding.utils';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksNetwork } from '@stacks/network';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { StacksTransactionRepository } from '@stacks-monorepo/common/database/repository/stacks-transaction.repository';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import GatewayTransactionTask = Components.Schemas.GatewayTransactionTask;
import BigNumber from 'bignumber.js';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import RefundTask = Components.Schemas.RefundTask;
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';

const MAX_NUMBER_OF_RETRIES = 3;

@Injectable()
export class TransactionProcessorService {
  private readonly logger: Logger;

  constructor(
    private readonly redisHelper: RedisHelper,
    @Inject(ProviderKeys.WALLET_SIGNER) private readonly walletSigner: string,
    private readonly transactionsHelper: TransactionsHelper,
    private readonly gatewayContract: GatewayContract,
    @Inject(ProviderKeys.STACKS_NETWORK) private readonly network: StacksNetwork,
    private readonly slackApi: SlackApi,
    private readonly stacksTransactionRepository: StacksTransactionRepository,
    private readonly gasServiceContract: GasServiceContract,
    private readonly hiroApiHelper: HiroApiHelper,
  ) {
    this.logger = new Logger(TransactionProcessorService.name);
  }

  // Runs after ApprovalsProcessorService handleNewTasks cron has run
  @Cron('2/10 * * * * *')
  async handlePendingTransactions() {
    await Locker.lock('pendingTransactions', async () => {
      this.logger.debug('Running pendingTransactions cron');

      let processedItems;
      do {
        try {
          processedItems = await this.stacksTransactionRepository.processPending(
            this.handlePendingTransactionsRaw.bind(this),
          );
        } catch (e) {
          if (e instanceof PrismaClientKnownRequestError && e.code === 'P2028') {
            // Transaction timeout
            this.logger.warn('StacksTransaction processing has timed out. Will be retried');
            await this.slackApi.sendWarn(
              `StacksTransaction processing timeout`,
              `Processing has timed out. Will be retried`,
            );
          }
          throw e;
        }
      } while (processedItems.length > 0);
    });
  }

  async handlePendingTransactionsRaw(items: StacksTransaction[]) {
    this.logger.debug(`Found ${items.length} pending StacksTransactions to handle`);

    const processedItems: StacksTransaction[] = [];
    for (const item of items) {
      try {
        // If txHash exists, check status. In practice, this point should not be reached often since transactions are marked
        // as SUCCESS based on events
        if (item.txHash) {
          const { isFinished, success } = await this.transactionsHelper.isTransactionSuccessfulWithTimeout(
            item.txHash,
            item.updatedAt.getTime(),
          );

          // If not yet finished, skip
          if (!isFinished) {
            continue;
          }

          // Mark as successfully executed
          if (success) {
            processedItems.push({
              ...item,
              status: StacksTransactionStatus.SUCCESS,
            });

            this.logger.log(
              `Transaction with hash ${item.txHash} of type ${item.type} was successfully executed, id ${item.taskItemId}!`,
            );

            continue;
          }

          // If max number of retries was reached
          if (item.retry >= MAX_NUMBER_OF_RETRIES) {
            processedItems.push({
              ...item,
              status: StacksTransactionStatus.FAILED,
            });

            this.logger.error(
              `Could not execute execute transaction with hash ${item.txHash} of type ${item.type} after ${item.retry} retries, id ${item.taskItemId}`,
            );
            await this.slackApi.sendError(
              `StacksTransaction error`,
              `Could not execute transaction with hash ${item.txHash} of type ${item.type} after ${item.retry} retries, id ${item.taskItemId}`,
            );

            continue;
          }
        }

        // Send transaction or retry
        const processedItem = await this.processStacksTransaction(item);

        processedItems.push(processedItem);
      } catch (e) {
        this.logger.warn(
          `An error occurred while processing StacksTransaction with id ${item.taskItemId}. Will be retried`,
          e,
        );
        await this.slackApi.sendWarn(
          `Stacks transaction processing error`,
          `An error occurred while processing StacksTransaction with id ${item.taskItemId}. Will be retried`,
        );
      }
    }

    return processedItems;
  }

  private async processStacksTransaction(item: StacksTransaction) {
    if (item.type === StacksTransactionType.GATEWAY) {
      const extraData = item.extraData as unknown as GatewayTransactionTask;

      if (!extraData?.executeData) {
        this.logger.error(`Invalid StacksTransaction with type GATEWAY ${item.taskItemId} without externalData`);
        await this.slackApi.sendError(
          'StacksTransaction type GATEWAY error',
          `Invalid StacksTransaction with type GATEWAY ${item.taskItemId} without externalData`,
        );

        return {
          ...item,
          status: StacksTransactionStatus.FAILED,
        };
      }

      const txHash = await this.processGatewayTx(extraData.executeData, item.retry);

      return {
        ...item,
        retry: !item.txHash ? item.retry : item.retry + 1, // keep retry the same if sending the first transaction
        txHash,
      };
    }

    if (item.type === StacksTransactionType.REFUND) {
      const extraData = item.extraData as unknown as RefundTask;

      if (!extraData?.message || !extraData?.refundRecipientAddress || !extraData?.remainingGasBalance) {
        this.logger.error(`Invalid StacksTransaction with type REFUND ${item.taskItemId} without externalData`);
        await this.slackApi.sendError(
          'StacksTransaction type REFUND error',
          `Invalid StacksTransaction with type REFUND ${item.taskItemId} without externalData`,
        );

        return {
          ...item,
          status: StacksTransactionStatus.FAILED,
        };
      }

      const txHash = await this.processRefundTx(extraData);

      return {
        ...item,
        retry: !item.txHash && txHash ? item.retry : item.retry + 1, // keep retry the same if sending the first transaction
        txHash,
      };
    }

    this.logger.error(`Unknown type ${item.type} received for StacksTransaction ${item.taskItemId}`);
    await this.slackApi.sendError(
      'StacksTransaction unknown type',
      `Unknown type ${item.type} received for StacksTransaction ${item.taskItemId}`,
    );

    return {
      ...item,
      status: StacksTransactionStatus.FAILED,
    };
  }

  private async processGatewayTx(externalData: string, retry: number = 0) {
    try {
      const data = gatewayTxDataDecoder(DecodingUtils.deserialize(BinaryUtils.base64ToHex(externalData)));

      this.logger.log(`Trying to execute Gateway transaction with externalData:`);
      this.logger.log(data);

      let fee = await this.redisHelper.get<string>(CacheInfo.GatewayTxFee(retry).key);

      if (!fee) {
        const initialTx = await this.gatewayContract.buildTransactionExternalFunction(data, this.walletSigner);

        fee = await this.transactionsHelper.getTransactionGas(initialTx, retry, this.network);

        await this.redisHelper.set(CacheInfo.GatewayTxFee(retry).key, fee, CacheInfo.GatewayTxFee(retry).ttl);
      }

      // After estimating the gas, we need to build the tx again
      const transaction = await this.gatewayContract.buildTransactionExternalFunction(
        data,
        this.walletSigner,
        BigInt(fee),
      );

      return await this.transactionsHelper.sendTransaction(transaction);
    } catch (e) {
      await this.deleteGatewayTxFeeCache();

      throw e;
    }
  }

  private async processRefundTx(response: RefundTask) {
    this.logger.log(
      `Trying to execute Refund transaction for ${response.message.messageID}, for account ${response.refundRecipientAddress},` +
        ` token $${response.remainingGasBalance.tokenID || CONSTANTS.STX_IDENTIFIER}, amount ${response.remainingGasBalance.amount}`,
    );

    const gasImpl = await this.gasServiceContract.getGasImpl();

    const addressBalance = await this.hiroApiHelper.getAccountBalance(gasImpl);

    let tokenBalance: BigNumber;

    if (response.remainingGasBalance.tokenID) {
      const token = addressBalance.fungible_tokens[response.remainingGasBalance.tokenID];

      tokenBalance = new BigNumber(token?.balance ?? 0);
    } else {
      tokenBalance = new BigNumber(addressBalance.stx.balance ?? 0);
    }

    if (tokenBalance.lt(response.remainingGasBalance.amount)) {
      const errorMsg =
        `Could not process refund for ${response.message.messageID}, for account ${response.refundRecipientAddress},` +
        ` Insufficient balance for token ${response.remainingGasBalance.tokenID || CONSTANTS.STX_IDENTIFIER}` +
        ` in gas service impl contract ${gasImpl}. Needed ${response.remainingGasBalance.amount},` +
        ` but balance is ${tokenBalance.toFixed()}`;

      this.logger.error(errorMsg);
      await this.slackApi.sendError('Refund task error', errorMsg);

      return null;
    }

    const [messageTxHash, logIndex] = response.message.messageID.split('-');

    const transaction = await this.gasServiceContract.refund(
      this.walletSigner,
      gasImpl,
      messageTxHash,
      logIndex,
      response.refundRecipientAddress,
      response.remainingGasBalance.amount,
    );

    return await this.transactionsHelper.sendTransaction(transaction);
  }

  private async deleteGatewayTxFeeCache() {
    await this.redisHelper.delete(
      CacheInfo.GatewayTxFee(0).key,
      CacheInfo.GatewayTxFee(1).key,
      CacheInfo.GatewayTxFee(2).key,
      CacheInfo.GatewayTxFee(3).key,
    );
  }
}
