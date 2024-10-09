import { ApiConfigService, CacheInfo, mapRawEventsToSmartContractEvents } from '@stacks-monorepo/common';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connectWebSocketClient, StacksApiWebSocketClient } from '@stacks/blockchain-api-client';
import { RpcAddressTxNotificationParams } from '@stacks/blockchain-api-client/src/types';
import { getContractAddress, getEventType, ScEvent } from './types';
import { DecodingUtils } from '@stacks-monorepo/common/utils/decoding.utils';

@Injectable()
export class EventProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly contractGateway: string;
  private readonly contractGasService: string;
  private readonly hiroWs: string;

  private client?: StacksApiWebSocketClient;
  private gatewaySubscription?: any;
  private gasSubscription?: any;

  private readonly logger: Logger;

  constructor(
    private readonly redisHelper: RedisHelper,
    apiConfigService: ApiConfigService,
  ) {
    this.contractGateway = apiConfigService.getContractGateway();
    this.contractGasService = apiConfigService.getContractGasService();
    this.hiroWs = apiConfigService.getHiroWsUrl();
    this.logger = new Logger(EventProcessorService.name);
  }

  async onModuleInit() {
    await this.subscribeToEvents();
  }

  async onModuleDestroy() {
    await this.unsubscribe();
  }

  private async subscribeToEvents() {
    this.client = await connectWebSocketClient(this.hiroWs);

    this.gatewaySubscription = await this.client.subscribeAddressTransactions(
      this.contractGateway,
      async (notification: RpcAddressTxNotificationParams) => {
        await this.consumeEvents(notification);
      },
    );

    this.gasSubscription = await this.client.subscribeAddressTransactions(
      this.gasSubscription,
      async (notification: RpcAddressTxNotificationParams) => {
        await this.consumeEvents(notification);
      },
    );
  }

  private async unsubscribe() {
    await this.gatewaySubscription?.unsubscribe();
    await this.gasSubscription?.unsubscribe();
  }

  async consumeEvents(notification: RpcAddressTxNotificationParams) {
    try {
      const events = mapRawEventsToSmartContractEvents(notification.tx.events);

      const crossChainTransactions = new Set<string>();

      for (const event of events) {
        const shouldHandle = this.handleEvent(event);

        if (shouldHandle) {
          crossChainTransactions.add(event.tx_id);
        }
      }

      if (crossChainTransactions.size > 0) {
        await this.redisHelper.sadd(CacheInfo.CrossChainTransactions().key, ...crossChainTransactions);
      }
    } catch (error) {
      this.logger.error(
        `An unhandled error occurred when consuming events for tx id ${notification.tx_id}: ${JSON.stringify(notification.tx.events)}`,
      );
      this.logger.error(error);

      throw error;
    }
  }

  private handleEvent(event: ScEvent): boolean {
    const contractAddress = getContractAddress(event);
    if (contractAddress === this.contractGasService) {
      const eventName = getEventType(event);

      const validEvent =
        eventName === Events.GAS_PAID_FOR_CONTRACT_CALL_EVENT ||
        eventName === Events.NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT ||
        eventName === Events.GAS_ADDED_EVENT ||
        eventName === Events.NATIVE_GAS_ADDED_EVENT ||
        eventName === Events.REFUNDED_EVENT;

      if (validEvent) {
        this.logger.debug('Received Gas Service event from Stacks:');
        this.logger.debug(JSON.stringify(event));
      }

      return validEvent;
    }

    if (contractAddress === this.contractGateway) {
      const eventName = getEventType(event);

      const validEvent =
        eventName === Events.CONTRACT_CALL_EVENT ||
        eventName === Events.SIGNERS_ROTATED_EVENT ||
        eventName === Events.MESSAGE_APPROVED_EVENT ||
        eventName === Events.MESSAGE_EXECUTED_EVENT;

      if (validEvent) {
        this.logger.debug('Received Gateway event from Stacks:');
        this.logger.debug(JSON.stringify(event));
      }

      return validEvent;
    }

    return false;
  }
}
