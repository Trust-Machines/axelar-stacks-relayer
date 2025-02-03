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
import TaskItem = Components.Schemas.TaskItem;
import GatewayTransactionTask = Components.Schemas.GatewayTransactionTask;
import ExecuteTask = Components.Schemas.ExecuteTask;
import RefundTask = Components.Schemas.RefundTask;
import VerifyTask = Components.Schemas.VerifyTask;
import { AxiosError } from 'axios';

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
    private readonly gasServiceContract: GasServiceContract,
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly cosmWasmService: CosmwasmService,
    @Inject(ProviderKeys.STACKS_NETWORK) private readonly network: StacksNetwork,
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
    let lastTaskUUID = (await this.redisHelper.get<string>(CacheInfo.LastTaskUUID().key)) || undefined;

    this.logger.debug(`Trying to process tasks for stacks starting from id: ${lastTaskUUID}`);

    // Process as many tasks as possible until no tasks are left or there is an error
    let tasks: TaskItem[] = [];
    do {
      try {
        const response = await this.axelarGmpApi.getTasks(CONSTANTS.SOURCE_CHAIN_NAME, lastTaskUUID);

        // TODO: Remove
        // response.data.tasks.push({
        //   id: 'test',
        //   type: 'GATEWAY_TX',
        //   chain: 'stacks',
        //   timestamp: '',
        //   task: {
        //     executeData: Buffer.from('0c00000003046461746102000001410b000000010c0000000510636f6e74726163742d61646472657373061a8675ab7c8fc22258bde371272c80e5710a25885218696e746572636861696e2d746f6b656e2d736572766963650a6d6573736167652d69640d000000483078346230353932616464383130616361616632383338326539346434656162303237613530333832633566343361663065343737623635633863353661636263342d34373732310c7061796c6f61642d68617368020000002020e12deade346d07016d83bf18bc315e11eb984e446d4158ce64faea79cca09e0e736f757263652d616464726573730d000000416178656c6172313537686c376770756b6e6a6d6874616332716e706875617a76327965726661677661376c73753976756a3270676e33327a323271613236646b340c736f757263652d636861696e0d000000066178656c61720866756e6374696f6e0d00000010617070726f76652d6d657373616765730570726f6f6602000001df0c000000020a7369676e6174757265730b0000000202000000413ec83c61581292465e98207bf6a7cfe63945bfc994a43ec65855d1d5d984776803f5bc05bd89646b74a411b49a2c9de2d7447e8500f9ca8529f5467fc7919d0f010200000041d7d80c9efe8ba857f3fa4e2cec358a08661fe010911681b9aaf277faaf4b9c871820f75320bf29cfd91098f2e2484f3f681a322d3dc555c68160fef4a5265d0901077369676e6572730c00000003056e6f6e63650200000020000000000000000000000000000000000000000000000000000000000038d32c077369676e6572730b000000030c00000002067369676e65720200000021026e4a6fc3a6988c4cd7d3bc02e07bac8b72a9f5342d92f42161e7b6e57dd47e180677656967687401000000000000000000000000000000010c00000002067369676e6572020000002102d19c406d763c98d98554c980ae03543b936aad0c3f1289a367a0c2aafb71e8c10677656967687401000000000000000000000000000000010c00000002067369676e6572020000002103ea531f69879b3b15b6e3fe262250d5ceca6217e03e4def6919d4bdce3a7ec389067765696768740100000000000000000000000000000001097468726573686f6c640100000000000000000000000000000002', 'hex').toString('base64'),
        //   }
        // });

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

            // Stop processing in case of an error and retry from the same task
            return;
          }
        }

        this.logger.debug(`Successfully processed ${tasks.length}, last task UUID ${lastTaskUUID}`);
      } catch (e) {
        this.logger.error(`Error retrieving tasks... Last task UUID ${lastTaskUUID}`, e);

        if (e instanceof AxiosError) {
          this.logger.error(e.response?.data);
        }

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
  }

  async handlePendingCosmWasmTransactionRaw() {
    const keys = await this.redisHelper.scan(CacheInfo.PendingCosmWasmTransaction('*').key);

    if (keys.length === 0) {
      return;
    }

    for (const key of keys) {
      const cachedValue = await this.cosmWasmService.getCosmWasmTransaction(key);
      if (!cachedValue) continue;

      this.logger.debug(`Trying to process ${cachedValue.type} task: ${JSON.stringify(cachedValue)}`);

      if (cachedValue.broadcastID) {
        await this.cosmWasmService.handleBroadcastStatus(key, cachedValue);
      } else {
        await this.cosmWasmService.broadcastCosmWasmTransaction(key, cachedValue);
      }
    }
  }
}
