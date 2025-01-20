import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiConfigService, AxelarGmpApi, CacheInfo } from '@stacks-monorepo/common';
import { MessageApprovedEvent } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { Locker, mapRawEventsToSmartContractEvents } from '@stacks-monorepo/common/utils';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { AxiosError } from 'axios';
import { GasServiceProcessor, GatewayProcessor, ItsProcessor } from './processors';

@Injectable()
export class CrossChainTransactionProcessorService {
  private readonly contractGatewayStorage: string;
  private readonly contractGasServiceStorage: string;
  private readonly contractItsStorage: string;
  private readonly logger: Logger;

  constructor(
    private readonly gatewayProcessor: GatewayProcessor,
    private readonly gasServiceProcessor: GasServiceProcessor,
    private readonly itsProcessor: ItsProcessor,
    private readonly axelarGmpApi: AxelarGmpApi,
    private readonly redisHelper: RedisHelper,
    private readonly hiroApiHelper: HiroApiHelper,
    apiConfigService: ApiConfigService,
  ) {
    this.contractGatewayStorage = apiConfigService.getContractGatewayStorage();
    this.contractGasServiceStorage = apiConfigService.getContractGasServiceStorage();
    this.contractItsStorage = apiConfigService.getContractItsStorage();
    this.logger = new Logger(CrossChainTransactionProcessorService.name);
  }

  // Runs after EventProcessor cron has run
  @Cron('5/10 * * * * *')
  async processCrossChainTransactions() {
    await Locker.lock('processCrossChainTransactions', this.processCrossChainTransactionsRaw.bind(this));
  }

  async processCrossChainTransactionsRaw() {
    this.logger.debug('Running processCrossChainTransactions cron');

    const txHashes = await this.redisHelper.smembers(CacheInfo.CrossChainTransactions().key);
    for (const txHash of txHashes) {
      try {
        const { transaction, fee } = await this.hiroApiHelper.getTransactionWithFee(txHash);
        // Wait for transaction to be finished
        if ((transaction.tx_status as any) === 'pending') {
          continue;
        }

        if (transaction.tx_status === 'success') {
          await this.handleEvents(transaction, fee);
        }

        await this.redisHelper.srem(CacheInfo.CrossChainTransactions().key, txHash);
      } catch (e) {
        this.logger.warn(`An error occurred while processing cross chain transaction ${txHash}. Will be retried`, e);
      }
    }
  }

  private async handleEvents(transaction: Transaction, fee: string) {
    const eventsToSend = [];

    const approvalEvents = [];

    const events = mapRawEventsToSmartContractEvents(transaction.events);

    for (const [index, rawEvent] of events.entries()) {
      const address = rawEvent.contract_log.contract_id;
      let transferAmount = '0';
      if (transaction.tx_type === 'token_transfer') {
        transferAmount = transaction.token_transfer.amount;
      }

      if (address === this.contractGatewayStorage) {
        const event = await this.gatewayProcessor.handleGatewayEvent(
          rawEvent,
          transaction,
          rawEvent.event_index,
          fee,
          transferAmount,
        );

        if (event) {
          eventsToSend.push(event);

          if (event.type === 'MESSAGE_APPROVED') {
            approvalEvents.push(event);
          }
        }

        continue;
      }

      if (address === this.contractGasServiceStorage) {
        const event = this.gasServiceProcessor.handleGasServiceEvent(
          rawEvent,
          transaction,
          index,
          rawEvent.event_index,
          fee,
        );

        if (event) {
          eventsToSend.push(event);
        }
      }

      if (address === this.contractItsStorage) {
        const event = this.itsProcessor.handleItsEvent(
          rawEvent,
          transaction,
          rawEvent.event_index,
        );

        if (event) {
          eventsToSend.push(event);
        }
      }
    }

    if (!eventsToSend.length) {
      return;
    }

    // Set cost for approval events if needed
    for (const event of approvalEvents) {
      const approvalEvent = event as MessageApprovedEvent;

      approvalEvent.cost.amount = String(BigInt(fee) / BigInt(approvalEvents.length));
    }

    try {
      await this.axelarGmpApi.postEvents(eventsToSend, transaction.tx_id);
    } catch (e) {
      this.logger.error('Could not send all events to GMP API...', e);

      if (e instanceof AxiosError) {
        this.logger.error(e.response?.data);
      }

      throw e;
    }
  }
}
