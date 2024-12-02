import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MessageApprovedStatus } from '@prisma/client';
import {
  ApiConfigService,
  BinaryUtils,
  CacheInfo,
  Constants,
  GasServiceContract,
  Locker,
} from '@stacks-monorepo/common';
import { AxelarGmpApi } from '@stacks-monorepo/common/api/axelar.gmp.api';
import {
  BroadcastRequest,
  BroadcastStatus,
  Components,
  ConstructProofTask,
} from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { awaitSuccess } from '@stacks-monorepo/common/utils/await-success';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { DecodingUtils, gatewayTxDataDecoder } from '@stacks-monorepo/common/utils/decoding.utils';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksNetwork } from '@stacks/network';
import BigNumber from 'bignumber.js';
import { PendingConstructProof } from './entities/pending-construct-proof';
import { PendingTransaction } from './entities/pending-transaction';
import TaskItem = Components.Schemas.TaskItem;
import GatewayTransactionTask = Components.Schemas.GatewayTransactionTask;
import ExecuteTask = Components.Schemas.ExecuteTask;
import RefundTask = Components.Schemas.RefundTask;

const MAX_NUMBER_OF_RETRIES = 3;
const CONSTRUCT_PROOF_POLL_TIMEOUT_MILLIS = 10_000;
const CONSTRUCT_PROOF_POLL_INTERVAL = 3_000;
export const AXELAR_CHAIN = 'axelarnet'; // TODO: Update it to 'axelar'

@Injectable()
export class ApprovalsProcessorService {
  private readonly logger: Logger;
  private readonly axelarContractIts: string;

  constructor(
    private readonly axelarGmpApi: AxelarGmpApi,
    private readonly redisHelper: RedisHelper,
    @Inject(ProviderKeys.WALLET_SIGNER) private readonly walletSigner: string,
    private readonly transactionsHelper: TransactionsHelper,
    private readonly gatewayContract: GatewayContract,
    private readonly messageApprovedRepository: MessageApprovedRepository,
    private readonly gasServiceContract: GasServiceContract,
    private readonly hiroApiHelper: HiroApiHelper,
    apiConfigService: ApiConfigService,
    @Inject(ProviderKeys.STACKS_NETWORK) private readonly network: StacksNetwork,
  ) {
    this.logger = new Logger(ApprovalsProcessorService.name);

    this.axelarContractIts = apiConfigService.getAxelarContractIts();
  }

  @Cron('0/20 * * * * *')
  async handleNewTasks() {
    await Locker.lock('handleNewTasks', this.handleNewTasksRaw.bind(this));
  }

  @Cron('3/6 * * * * *')
  async handlePendingTransactions() {
    await Locker.lock('pendingTransactions', this.handlePendingTransactionsRaw.bind(this));
  }

  @Cron('5/5 * * * * *')
  async handlePendingConstructProof() {
    await Locker.lock('pendingConstructProof', this.handlePendingConstructProofRaw.bind(this));
  }

  async handleNewTasksRaw() {
    let lastTaskUUID = (await this.redisHelper.get<string>(CacheInfo.LastTaskUUID().key)) || undefined;

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

            await this.redisHelper.set(CacheInfo.LastTaskUUID().key, lastTaskUUID, CacheInfo.LastTaskUUID().ttl);
          } catch (e) {
            this.logger.error(`Could not process task ${task.id}`, task, e);

            // Stop processing in case of an error and retry from the sam task
            return;
          }
        }

        this.logger.debug(`Successfully processed ${tasks.length}`);
      } catch (e) {
        this.logger.error('Error retrieving tasks...', e);

        return;
      }
    } while (tasks.length > 0);
  }

  async handlePendingTransactionsRaw() {
    const keys = await this.redisHelper.scan(CacheInfo.PendingTransaction('*').key);
    for (const key of keys) {
      const cachedValue = await this.redisHelper.get<PendingTransaction>(key);

      await this.redisHelper.delete(key);

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

        continue;
      }

      try {
        await this.processGatewayTxTask(externalData, retry);
      } catch (e) {
        this.logger.error('Error while trying to retry transaction...');
        this.logger.error(e);

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

    // TODO: Handle retries in case of transaction failing?
    const txHash = await this.transactionsHelper.sendTransaction(transaction);

    this.logger.debug(`Processed refund for ${response.message.messageID}, sent transaction ${txHash}`);
  }

  async processConstructProofTask(response: ConstructProofTask) {
    const request = this.buildConstructProofRequest(response);

    const id = `${response.message.sourceChain}_${response.message.messageID}`;
    const constructProof: PendingConstructProof = {
      request,
      retry: 0,
    };
    await this.storeConstructProof(CacheInfo.PendingConstructProof(id).key, constructProof);
  }

  async handlePendingConstructProofRaw() {
    const keys = await this.redisHelper.scan(CacheInfo.PendingConstructProof('*').key);

    if (keys.length === 0) {
      return;
    }

    for (const key of keys) {
      const cachedValue = await this.getConstructProof(key);
      if (!cachedValue) continue;

      this.logger.debug(`Trying to process CONSTRUCT_PROOF task: ${JSON.stringify(cachedValue)}`);

      if (cachedValue.broadcastID) {
        await this.handleBroadcastStatus(key, cachedValue);
      } else {
        await this.broadcastConstructProof(key, cachedValue);
      }
    }
  }

  private async handleBroadcastStatus(key: string, constructProof: PendingConstructProof) {
    if (!constructProof.broadcastID) {
      return;
    }

    const { success } = await awaitSuccess(
      constructProof.broadcastID,
      CONSTRUCT_PROOF_POLL_TIMEOUT_MILLIS,
      CONSTRUCT_PROOF_POLL_INTERVAL,
      `CONSTRUCT_PROOF:${constructProof.broadcastID}`,
      async (id) => await this.axelarGmpApi.getMsgExecuteContractBroadcastStatus(id),
      (status: BroadcastStatus) => status === 'SUCCESS',
      this.logger,
    );

    if (success) {
      await this.redisHelper.delete(key);
    } else {
      await this.updateRetry(key, constructProof);
    }
  }

  private async broadcastConstructProof(key: string, constructProof: PendingConstructProof) {
    if (constructProof.retry >= MAX_NUMBER_OF_RETRIES) {
      this.logger.error(`Max retries reached for construct_proof: ${JSON.stringify(constructProof.request)}`);
      await this.redisHelper.delete(key);
      return;
    }

    try {
      this.logger.debug(`Broadcasting CONSTRUCT_PROOF request: ${JSON.stringify(constructProof.request)}`);
      const broadcastID = await this.axelarGmpApi.broadcastMsgExecuteContract(constructProof.request);
      await this.storeConstructProof(key, { ...constructProof, broadcastID });
      this.logger.debug(`CONSTRUCT_PROOF broadcast successful, ID: ${broadcastID}`);
    } catch (error) {
      this.logger.error('Error broadcasting construct_proof');
      this.logger.error(error);
      await this.updateRetry(key, constructProof);
    }
  }

  private async updateRetry(key: string, constructProof: PendingConstructProof) {
    const updatedProof: PendingConstructProof = {
      ...constructProof,
      retry: constructProof.retry + 1,
    };
    await this.storeConstructProof(key, updatedProof);
  }

  private buildConstructProofRequest(task: ConstructProofTask): BroadcastRequest {
    if (task.message.sourceAddress === this.axelarContractIts && task.message.sourceChain === AXELAR_CHAIN) {
      return {
        construct_proof_with_payload: {
          message_id: { source_chain: task.message.sourceChain, message_id: task.message.messageID },
          payload: task.payload,
        },
      };
    } else {
      return {
        construct_proof: [
          {
            source_chain: task.message.sourceChain,
            message_id: task.message.messageID,
          },
        ],
      };
    }
  }

  private async storeConstructProof(key: string, constructProof: PendingConstructProof) {
    await this.redisHelper.set<PendingConstructProof>(key, constructProof, Constants.oneMinute() * 10);
  }

  private async getConstructProof(key: string): Promise<PendingConstructProof | undefined> {
    return await this.redisHelper.get<PendingConstructProof>(key);
  }
}
