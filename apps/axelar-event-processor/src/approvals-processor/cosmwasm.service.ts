import { Injectable, Logger } from '@nestjs/common';
import {
  BroadcastID,
  WasmRequest,
  BroadcastStatus,
  Components,
  ConstructProofTask,
} from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { ApiConfigService, AxelarGmpApi, Constants } from '@stacks-monorepo/common';
import { PendingCosmWasmTransaction } from './entities/pending-cosm-wasm-transaction';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import VerifyTask = Components.Schemas.VerifyTask;
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

const COSM_WASM_TRANSACTION_POLL_TIMEOUT_MILLIS = 120_000;
const MAX_NUMBER_OF_RETRIES = 3;

@Injectable()
export class CosmwasmService {
  private readonly logger: Logger;

  private readonly axelarContractIts: string;
  private readonly stacksContractItsProxy: string;

  constructor(
    private readonly redisHelper: RedisHelper,
    private readonly axelarGmpApi: AxelarGmpApi,
    private readonly apiConfigService: ApiConfigService,
    private readonly slackApi: SlackApi,
  ) {
    this.axelarContractIts = apiConfigService.getAxelarContractIts();
    this.stacksContractItsProxy = apiConfigService.getContractItsProxy();

    this.logger = new Logger(CosmwasmService.name);
  }

  buildConstructProofRequest(task: ConstructProofTask): WasmRequest {
    // Handle ITS Hub -> Stacks ITS case
    if (task.message.sourceAddress === this.axelarContractIts && task.message.sourceChain === CONSTANTS.AXELAR_CHAIN) {
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

  buildVerifyRequest(task: VerifyTask): WasmRequest {
    const payloadHash = Buffer.from(task.message.payloadHash, 'base64').toString('hex');

    // Handle Stacks ITS -> ITS Hub case
    if (
      task.message.sourceAddress === this.stacksContractItsProxy &&
      task.message.destinationAddress === this.axelarContractIts &&
      task.destinationChain === CONSTANTS.AXELAR_CHAIN
    ) {
      return {
        verify_message_with_payload: {
          message: {
            cc_id: { source_chain: task.message.sourceChain, message_id: task.message.messageID },
            destination_chain: CONSTANTS.AXELAR_CHAIN,
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

    const wasmContractAddress =
      cosmWasmTransaction.type === 'CONSTRUCT_PROOF'
        ? this.apiConfigService.getAxelarMultisigProverContract()
        : this.apiConfigService.getAxelarGatewayContract();

    const { isFinished, success } = await this.isTransactionSuccessfulWithTimeout(
      cosmWasmTransaction.broadcastID,
      wasmContractAddress,
      cosmWasmTransaction.timestamp,
    );

    if (success) {
      this.logger.log(
        `Successfully sent CosmWasm transaction for ${cosmWasmTransaction.type} broadcast id: ${
          cosmWasmTransaction.broadcastID
        }`,
      );

      await this.redisHelper.delete(key);

      return;
    }

    if (!isFinished) {
      return;
    }

    this.logger.warn(
      `There was an error sending CosmWasm transaction for ${cosmWasmTransaction.type} broadcast id: ${
        cosmWasmTransaction.broadcastID
      }. Will be retried. Status: ${success}`,
    );

    await this.updateRetry(key, {
      ...cosmWasmTransaction,
      broadcastID: undefined,
    });
  }

  async broadcastCosmWasmTransaction(key: string, cosmWasmTransaction: PendingCosmWasmTransaction) {
    if (cosmWasmTransaction.retry >= MAX_NUMBER_OF_RETRIES) {
      this.logger.error(
        `Max retries reached for ${cosmWasmTransaction.type}: ${JSON.stringify(cosmWasmTransaction.request)}`,
      );
      await this.slackApi.sendError(
        'CosmWasm transaction error',
        `Max retries reached for ${cosmWasmTransaction.type}: ${JSON.stringify(cosmWasmTransaction.request)}`,
      );
      await this.redisHelper.delete(key);
      return;
    }

    const wasmContractAddress =
      cosmWasmTransaction.type === 'CONSTRUCT_PROOF'
        ? this.apiConfigService.getAxelarMultisigProverContract()
        : this.apiConfigService.getAxelarGatewayContract();

    try {
      this.logger.debug(
        `Trying to send CosmWasm transaction for ${cosmWasmTransaction.type} request: ${JSON.stringify(
          cosmWasmTransaction.request,
        )}, retry ${cosmWasmTransaction.retry}`,
      );
      const broadcastID = await this.axelarGmpApi.broadcastMsgExecuteContract(
        cosmWasmTransaction.request,
        wasmContractAddress,
      );
      await this.storeCosmWasmTransaction(key, { ...cosmWasmTransaction, broadcastID, timestamp: Date.now() });
      this.logger.log(`${cosmWasmTransaction.type} broadcast successful, ID: ${broadcastID}`);
    } catch (e) {
      this.logger.warn(`Error broadcasting ${cosmWasmTransaction.type}`, e);
      await this.slackApi.sendWarn(
        'CosmWasm transaction error',
        `Error broadcasting ${cosmWasmTransaction.type}. Will be retried`,
      );
      await this.updateRetry(key, cosmWasmTransaction);
    }
  }

  private async updateRetry(key: string, cosmWasmTransaction: PendingCosmWasmTransaction) {
    const updatedProof: PendingCosmWasmTransaction = {
      ...cosmWasmTransaction,
      retry: cosmWasmTransaction.retry + 1,
      timestamp: Date.now(),
    };
    await this.storeCosmWasmTransaction(key, updatedProof);
  }

  private async isTransactionSuccessfulWithTimeout(
    id: BroadcastID,
    wasmContractAddress: string,
    timestampMillis: number,
  ): Promise<{
    isFinished: boolean;
    success: boolean;
  }> {
    let status: BroadcastStatus | null = null;
    try {
      status = await this.axelarGmpApi.getMsgExecuteContractBroadcastStatus(id, wasmContractAddress);
    } catch (e) {
      this.logger.debug(`Failed to get CosmWasm transaction ${id} from ${wasmContractAddress} at this time`, e);
    }

    const isPending = !status || status === 'RECEIVED';

    // Exit early if the transaction is still pending after timeout
    if (isPending && Date.now() - timestampMillis > COSM_WASM_TRANSACTION_POLL_TIMEOUT_MILLIS) {
      return {
        isFinished: true,
        success: false,
      };
    }

    const success = !!status && status === 'SUCCESS';

    return { isFinished: !isPending, success };
  }
}
