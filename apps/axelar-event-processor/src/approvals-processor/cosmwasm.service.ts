import { Injectable, Logger } from '@nestjs/common';
import {
  BroadcastRequest,
  BroadcastStatus,
  Components,
  ConstructProofTask,
} from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { AXELAR_CHAIN } from './approvals.processor.service';
import { ApiConfigService, AxelarGmpApi, Constants } from '@stacks-monorepo/common';
import { PendingCosmWasmTransaction } from './entities/pending-cosm-wasm-transaction';
import { awaitSuccess } from '@stacks-monorepo/common/utils/await-success';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import VerifyTask = Components.Schemas.VerifyTask;

const COSM_WASM_TRANSACTION_POLL_TIMEOUT_MILLIS = 10_000;
const COSM_WASM_TRANSACTION_POLL_INTERVAL = 3_000;
const MAX_NUMBER_OF_RETRIES = 3;

@Injectable()
export class CosmwasmService {
  private readonly logger: Logger;

  private readonly axelarContractIts: string;
  private readonly stacksContractItsProxy: string;

  constructor(
    private readonly redisHelper: RedisHelper,
    private readonly axelarGmpApi: AxelarGmpApi,
    apiConfigService: ApiConfigService,
  ) {
    this.axelarContractIts = apiConfigService.getAxelarContractIts();
    this.stacksContractItsProxy = apiConfigService.getContractItsProxy();

    this.logger = new Logger(CosmwasmService.name);
  }

  buildConstructProofRequest(task: ConstructProofTask): BroadcastRequest {
    // Handle ITS Hub -> Stacks ITS case
    if (task.message.sourceAddress === this.axelarContractIts && task.message.sourceChain === AXELAR_CHAIN) {
      return {
        construct_proof_with_payload: {
          message_id: { source_chain: task.message.sourceChain, message_id: task.message.messageID },
          payload: Buffer.from(task.payload, 'base64').toString('hex'),
        },
      };
    }

    return {
      construct_proof: [
        {
          source_chain: task.message.sourceChain,
          message_id: task.message.messageID,
        },
      ],
    };
  }

  buildVerifyRequest(task: VerifyTask): BroadcastRequest {
    const payloadHash = Buffer.from(task.message.payloadHash, 'base64').toString('hex');

    // Handle Stacks ITS -> ITS Hub case
    if (
      task.message.sourceAddress === this.stacksContractItsProxy &&
      task.message.destinationAddress === this.axelarContractIts &&
      task.destinationChain === AXELAR_CHAIN
    ) {
      return {
        verify_message_with_payload: {
          message: {
            cc_id: { source_chain: task.message.sourceChain, message_id: task.message.messageID },
            destination_chain: AXELAR_CHAIN,
            destination_address: task.message.destinationAddress,
            source_address: task.message.sourceAddress,
            payload_hash: payloadHash,
          },
          payload: Buffer.from(task.payload, 'base64').toString('hex'),
        },
      };
    }

    return {
      verify_messages: [
        {
          cc_id: {
            source_chain: task.message.sourceChain,
            message_id: task.message.messageID,
          },
          destination_chain: task.destinationChain,
          destination_address: task.message.destinationAddress,
          source_address: task.message.sourceAddress,
          payload_hash: payloadHash,
        },
      ],
    };
  }

  async storeCosmWasmTransaction(key: string, cosmWasmTransaction: PendingCosmWasmTransaction) {
    await this.redisHelper.set<PendingCosmWasmTransaction>(key, cosmWasmTransaction, Constants.oneMinute() * 10);
  }

  async getCosmWasmTransaction(key: string): Promise<PendingCosmWasmTransaction | undefined> {
    return await this.redisHelper.get<PendingCosmWasmTransaction>(key);
  }

  async handleBroadcastStatus(key: string, cosmWasmTransaction: PendingCosmWasmTransaction) {
    if (!cosmWasmTransaction.broadcastID) {
      return;
    }

    const { success } = await awaitSuccess(
      cosmWasmTransaction.broadcastID,
      COSM_WASM_TRANSACTION_POLL_TIMEOUT_MILLIS,
      COSM_WASM_TRANSACTION_POLL_INTERVAL,
      `${cosmWasmTransaction.type}:${cosmWasmTransaction.broadcastID}`,
      async (id) => await this.axelarGmpApi.getMsgExecuteContractBroadcastStatus(id),
      (status: BroadcastStatus) => status === 'SUCCESS',
      this.logger,
    );

    if (success) {
      await this.redisHelper.delete(key);
    } else {
      await this.updateRetry(key, cosmWasmTransaction);
    }
  }

  async broadcastCosmWasmTransaction(key: string, cosmWasmTransaction: PendingCosmWasmTransaction) {
    if (cosmWasmTransaction.retry >= MAX_NUMBER_OF_RETRIES) {
      this.logger.error(
        `Max retries reached for ${cosmWasmTransaction.type}: ${JSON.stringify(cosmWasmTransaction.request)}`,
      );
      await this.redisHelper.delete(key);
      return;
    }

    try {
      this.logger.debug(
        `Broadcasting ${cosmWasmTransaction.type} request: ${JSON.stringify(cosmWasmTransaction.request)}`,
      );
      const broadcastID = await this.axelarGmpApi.broadcastMsgExecuteContract(cosmWasmTransaction.request);
      await this.storeCosmWasmTransaction(key, { ...cosmWasmTransaction, broadcastID });
      this.logger.debug(`${cosmWasmTransaction.type} broadcast successful, ID: ${broadcastID}`);
    } catch (error) {
      this.logger.error(`Error broadcasting ${cosmWasmTransaction.type}`);
      this.logger.error(error);
      await this.updateRetry(key, cosmWasmTransaction);
    }
  }

  private async updateRetry(key: string, cosmWasmTransaction: PendingCosmWasmTransaction) {
    const updatedProof: PendingCosmWasmTransaction = {
      ...cosmWasmTransaction,
      retry: cosmWasmTransaction.retry + 1,
    };
    await this.storeCosmWasmTransaction(key, updatedProof);
  }
}
