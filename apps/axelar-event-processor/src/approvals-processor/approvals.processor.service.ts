import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MessageApprovedStatus } from '@prisma/client';
import { BinaryUtils, CacheInfo, GasServiceContract, Locker } from '@stacks-monorepo/common';
import { AxelarGmpApi } from '@stacks-monorepo/common/api/axelar.gmp.api';
import { Components, ConstructProofTask } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { DecodingUtils, gatewayTxDataDecoder } from '@stacks-monorepo/common/utils/decoding.utils';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksNetwork } from '@stacks/network';
import BigNumber from 'bignumber.js';
import { PendingCosmWasmTransaction } from './entities/pending-cosm-wasm-transaction';
import { PendingTransaction } from './entities/pending-transaction';
import { CosmwasmService } from './cosmwasm.service';
import { AxiosError } from 'axios';
import {
  LAST_PROCESSED_DATA_TYPE,
  LastProcessedDataRepository,
} from '@stacks-monorepo/common/database/repository/last-processed-data.repository';
import TaskItem = Components.Schemas.TaskItem;
import GatewayTransactionTask = Components.Schemas.GatewayTransactionTask;
import ExecuteTask = Components.Schemas.ExecuteTask;
import RefundTask = Components.Schemas.RefundTask;
import VerifyTask = Components.Schemas.VerifyTask;
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { delay } from '@stacks-monorepo/common/utils/await-success';

const MAX_NUMBER_OF_RETRIES = 3;

@Injectable()
export class ApprovalsProcessorService {
  private readonly logger: Logger;

  constructor(
    private readonly axelarGmpApi: AxelarGmpApi,
    private readonly redisHelper: RedisHelper,
    @Inject(ProviderKeys.WALLET_SIGNER) private readonly walletSigner: string,
    private readonly transactionsHelper: TransactionsHelper,
    private readonly gatewayContract: GatewayContract,
    private readonly messageApprovedRepository: MessageApprovedRepository,
    private readonly lastProcessedDataRepository: LastProcessedDataRepository,
    private readonly gasServiceContract: GasServiceContract,
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly cosmWasmService: CosmwasmService,
    @Inject(ProviderKeys.STACKS_NETWORK) private readonly network: StacksNetwork,
    private readonly slackApi: SlackApi,
  ) {
    this.logger = new Logger(ApprovalsProcessorService.name);
  }

  @Cron('0/15 * * * * *')
  async handleNewTasks() {
    await Locker.lock('handleNewTasks', this.handleNewTasksRaw.bind(this));
  }

  @Cron('2/6 * * * * *')
  async handlePendingTransactions() {
    await Locker.lock('pendingTransactions', this.handlePendingTransactionsRaw.bind(this));
  }

  @Cron('4/6 * * * * *')
  async handlePendingCosmWasmTransaction() {
    await Locker.lock('pendingCosmWasmTransaction', this.handlePendingCosmWasmTransactionRaw.bind(this));
  }

  async handleNewTasksRaw() {
    let lastTaskUUID = await this.lastProcessedDataRepository.get(LAST_PROCESSED_DATA_TYPE.LAST_TASK_ID);

    this.logger.debug(`Trying to process tasks for stacks starting from id: ${lastTaskUUID}`);

    // Process as many tasks as possible until no tasks are left or there is an error
    let tasks: TaskItem[] = [];
    do {
      try {
        const response = await this.axelarGmpApi.getTasks(CONSTANTS.SOURCE_CHAIN_NAME, lastTaskUUID);

        if (response.data.tasks.length === 0) {
          this.logger.debug('No tasks left to process for now...');

          return;
        }

        tasks = response.data.tasks;

        for (const task of tasks) {
          try {
            await this.processTask(task);

            lastTaskUUID = task.id;

            await this.lastProcessedDataRepository.update(LAST_PROCESSED_DATA_TYPE.LAST_TASK_ID, lastTaskUUID);
          } catch (e) {
            this.logger.error(`Could not process task ${task.id} ${task.type}. Will be retried`, task, e);
            await this.slackApi.sendError('Task processing error', `Could not process task ${task.id}, ${task.type}. Will be retried`);

            // Stop processing in case of an error and retry from the same task
            return;
          }
        }

        this.logger.debug(`Successfully processed ${tasks.length} task, last task UUID ${lastTaskUUID}`);
      } catch (e) {
        this.logger.error(`Error retrieving tasks... Last task UUID ${lastTaskUUID}`, e);
        await this.slackApi.sendError(
          'Task processing error',
          `Error retrieving tasks... Last task UUID retrieved: ${lastTaskUUID}`,
        );

        if (e instanceof AxiosError) {
          this.logger.error(e.response?.data);
        }

        return;
      }
    } while (tasks.length > 0);
  }

  async handlePendingTransactionsRaw() {
    const keys = await this.redisHelper.scan(CacheInfo.PendingTransaction('*').key);

    await delay(500); // If we try to get the txStatus immediately after broadcasting the tx, we might get 404

    for (const key of keys) {
      const cachedValue = await this.redisHelper.getDel<PendingTransaction>(key);

      if (cachedValue === undefined) {
        continue;
      }

      const { txHash, externalData, retry } = cachedValue;

      const { success } = await this.transactionsHelper.awaitSuccess(txHash);

      // Nothing to do on success
      if (success) {
        this.logger.debug(`Transaction with hash ${txHash} was successfully executed!`);

        continue;
      }

      if (retry === MAX_NUMBER_OF_RETRIES) {
        this.logger.error(`Could not execute Gateway execute transaction with hash ${txHash} after ${retry} retries`);
        await this.slackApi.sendError(
          `Gateway transaction error`,
          `Could not execute Gateway execute transaction with hash ${txHash} after ${retry} retries`,
        );

        continue;
      }

      try {
        await this.processGatewayTxTask(externalData, retry);
      } catch (e) {
        this.logger.error('Error while trying to retry Gateway transaction...', e);
        await this.slackApi.sendError(
          `Gateway transaction retry error`,
          'Error while trying to retry transaction... Transaction could not be sent to chain. Will be retried',
        );

        // Set value back in cache to be retried again (with same retry number if it failed to even be sent to the chain)
        await this.redisHelper.set<PendingTransaction>(
          CacheInfo.PendingTransaction(txHash).key,
          {
            txHash,
            externalData,
            retry,
          },
          CacheInfo.PendingTransaction(txHash).ttl,
        );
      }
    }
  }

  private async processTask(task: TaskItem) {
    this.logger.debug('Received Axelar Task response:');
    this.logger.debug(JSON.stringify(task));

    if (task.type === 'GATEWAY_TX') {
      const response = task.task as GatewayTransactionTask;

      await this.processGatewayTxTask(response.executeData);

      return;
    }

    if (task.type === 'EXECUTE') {
      const response = task.task as ExecuteTask;

      await this.processExecuteTask(response, task.id);

      return;
    }

    if (task.type === 'REFUND') {
      const response = task.task as RefundTask;

      await this.processRefundTask(response);

      return;
    }

    if (task.type === 'CONSTRUCT_PROOF') {
      const response = task.task as ConstructProofTask;

      await this.processConstructProofTask(response);

      return;
    }

    if (task.type === 'VERIFY') {
      const response = task.task as VerifyTask;

      await this.processVerifyTask(response);

      return;
    }
  }

  private async processGatewayTxTask(externalData: string, retry: number = 0) {
    const data = gatewayTxDataDecoder(DecodingUtils.deserialize(BinaryUtils.base64ToHex(externalData)));

    this.logger.log(`Trying to execute Gateway transaction with externalData:`);
    this.logger.log(data);

    const initialTx = await this.gatewayContract.buildTransactionExternalFunction(data, this.walletSigner);
    if (!initialTx) {
      this.logger.log('Could not build gateway tx');
      return;
    }

    const fee = await this.transactionsHelper.getTransactionGas(initialTx, retry, this.network);

    // After estimating the gas, we need to build the tx again
    const transaction = await this.gatewayContract.buildTransactionExternalFunction(data, this.walletSigner, fee);
    if (!transaction) {
      this.logger.log('Could not build gateway tx');
      return;
    }

    const txHash = await this.transactionsHelper.sendTransaction(transaction);

    await this.redisHelper.set<PendingTransaction>(
      CacheInfo.PendingTransaction(txHash).key,
      {
        txHash,
        externalData,
        retry: retry + 1,
      },
      CacheInfo.PendingTransaction(txHash).ttl,
    );
  }

  private async processExecuteTask(response: ExecuteTask, taskItemId: string) {
    await this.messageApprovedRepository.createOrUpdate({
      sourceChain: response.message.sourceChain,
      messageId: response.message.messageID,
      status: MessageApprovedStatus.PENDING,
      sourceAddress: response.message.sourceAddress,
      contractAddress: response.message.destinationAddress,
      payloadHash: Buffer.from(response.message.payloadHash, 'base64').toString('hex'),
      payload: Buffer.from(response.payload, 'base64'),
      retry: 0,
      taskItemId,
      // Only support native token for gas
      availableGasBalance: !response.availableGasBalance.tokenID ? response.availableGasBalance.amount : '0',
    });

    this.logger.debug(
      `Processed EXECUTE task ${taskItemId}, message from ${response.message.sourceChain} with messageId ${response.message.messageID}`,
    );
  }

  private async processRefundTask(response: RefundTask) {
    let tokenBalance: BigNumber;

    const gasImpl = await this.gasServiceContract.getGasImpl();

    const addressBalance = await this.hiroApiHelper.getAccountBalance(gasImpl);

    try {
      if (response.remainingGasBalance.tokenID) {
        const token = addressBalance.fungible_tokens[response.remainingGasBalance.tokenID];

        tokenBalance = new BigNumber(token?.balance ?? 0);
      } else {
        tokenBalance = new BigNumber(addressBalance.stx.balance ?? 0);
      }

      if (tokenBalance.lt(response.remainingGasBalance.amount)) {
        throw new Error(
          `Insufficient balance for token ${response.remainingGasBalance.tokenID || CONSTANTS.STX_IDENTIFIER}` +
            ` in gas service impl contract ${gasImpl}. Needed ${response.remainingGasBalance.amount},` +
            ` but balance is ${tokenBalance.toFixed()}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Could not process refund for ${response.message.messageID}, for account ${response.refundRecipientAddress},` +
          ` token ${response.remainingGasBalance.tokenID}, amount ${response.remainingGasBalance.amount}`,
        e,
      );
      await this.slackApi.sendError(
        `Refund task error`,
        `Could not process refund for ${response.message.messageID} for account ${response.refundRecipientAddress},` +
        ` token ${response.remainingGasBalance.tokenID}, amount ${response.remainingGasBalance.amount}`,
      );

      return;
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

    const txHash = await this.transactionsHelper.sendTransaction(transaction);

    this.logger.debug(`Processed refund for ${response.message.messageID}, sent transaction ${txHash}`);
  }

  async processConstructProofTask(response: ConstructProofTask) {
    const request = this.cosmWasmService.buildConstructProofRequest(response);

    const id = `${response.message.sourceChain}_${response.message.messageID}`;
    const constructProofTransaction: PendingCosmWasmTransaction = {
      request,
      retry: 0,
      type: 'CONSTRUCT_PROOF',
    };
    await this.cosmWasmService.storeCosmWasmTransaction(
      CacheInfo.PendingCosmWasmTransaction(id).key,
      constructProofTransaction,
    );

    this.logger.debug(
      `Processed CONSTRUCT_PROOF task, message from ${response.message.sourceChain} with messageId ${response.message.messageID}`,
    );
  }

  async processVerifyTask(response: VerifyTask) {
    const request = this.cosmWasmService.buildVerifyRequest(response);

    const id = `${response.message.sourceChain}_${response.message.messageID}`;
    const verifyTransaction: PendingCosmWasmTransaction = {
      request,
      retry: 0,
      type: 'VERIFY',
    };
    await this.cosmWasmService.storeCosmWasmTransaction(
      CacheInfo.PendingCosmWasmTransaction(id).key,
      verifyTransaction,
    );

    this.logger.debug(
      `Processed VERIFY task, message to ${response.destinationChain} with messageId ${response.message.messageID}`,
    );
  }

  async handlePendingCosmWasmTransactionRaw() {
    const keys = await this.redisHelper.scan(CacheInfo.PendingCosmWasmTransaction('*').key);

    if (keys.length === 0) {
      return;
    }

    for (const key of keys) {
      const cachedValue = await this.cosmWasmService.getCosmWasmTransaction(key);
      if (!cachedValue) continue;

      if (cachedValue.broadcastID) {
        await this.cosmWasmService.handleBroadcastStatus(key, cachedValue);
      } else {
        await this.cosmWasmService.broadcastCosmWasmTransaction(key, cachedValue);
      }
    }
  }
}
