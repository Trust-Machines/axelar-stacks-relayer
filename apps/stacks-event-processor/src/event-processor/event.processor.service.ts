import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiConfigService, CacheInfo, Locker } from '@stacks-monorepo/common';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { getEventType, ScEvent } from './types';

@Injectable()
export class EventProcessorService {
  private readonly contractGatewayStorage: string;
  private readonly contractGasServiceStorage: string;

  private contractGatewayEventsKey: string;
  private contractGasServiceEventsKey: string;

  private readonly logger: Logger;

  constructor(
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly redisHelper: RedisHelper,
    apiConfigService: ApiConfigService,
  ) {
    this.contractGatewayStorage = apiConfigService.getContractGatewayStorage();
    this.contractGasServiceStorage = apiConfigService.getContractGasServiceStorage();
    this.contractGatewayEventsKey = CacheInfo.ContractLastProcessedEvent(this.contractGatewayStorage).key;
    this.contractGasServiceEventsKey = CacheInfo.ContractLastProcessedEvent(this.contractGasServiceStorage).key;

    this.logger = new Logger(EventProcessorService.name);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async pollEvents() {
    await Locker.lock('eventsPolling', async () => {
      const [gatewayLastProcessedEvent, gasLastProcessedEvent] = await Promise.all([
        this.redisHelper.get<string>(this.contractGatewayEventsKey),
        this.redisHelper.get<string>(this.contractGasServiceEventsKey),
      ]);

      await this.getContractEvents(
        this.contractGatewayStorage,
        this.contractGatewayEventsKey,
        gatewayLastProcessedEvent,
      );
      await this.getContractEvents(
        this.contractGasServiceStorage,
        this.contractGasServiceEventsKey,
        gasLastProcessedEvent,
      );
    });
  }

  private async getContractEvents(contractId: string, redisKey: string, lastProcessedEventKey: string | undefined) {
    let offset = 0;
    const limit = 20;
    let latestEventKey: string | null = null;

    this.logger.debug(
      `${contractId} start fetching events, offset: ${offset}, limit: ${limit}, lastProcessedEventKey: ${lastProcessedEventKey}`,
    );

    while (true) {
      try {
        const events = await this.hiroApiHelper.getContractEvents(contractId, offset, limit);
        if (events.length === 0) {
          this.logger.debug(`${contractId} no events for offset: ${offset} and limit: ${limit}`);
          break;
        }

        const firstEventKey = `${events[0].tx_id}-${events[0].event_index}`;

        if (firstEventKey === lastProcessedEventKey) {
          this.logger.debug(`${contractId} there are no new events`);
          break;
        }

        if (!latestEventKey) {
          latestEventKey = firstEventKey;
        }

        await this.consumeEvents(events, lastProcessedEventKey);

        offset += limit;
      } catch (error) {
        this.logger.error(`Failed to get events for ${contractId}`);
        this.logger.error(error);
        break;
      }
    }

    if (latestEventKey) {
      this.logger.debug(`${contractId} update latest event key to ${latestEventKey}`);
      await this.updateLastProcessedEventKey(redisKey, latestEventKey);
    }
  }

  private async updateLastProcessedEventKey(redisKey: string, lastProcessedEventKey: string) {
    await this.redisHelper.set(redisKey, lastProcessedEventKey);
  }

  async consumeEvents(events: ScEvent[], lastProcessedEventKey: string | undefined) {
    try {
      const crossChainTransactions = new Set<string>();

      for (const event of events) {
        const eventKey = `${event.tx_id}-${event.event_index}`;

        if (eventKey === lastProcessedEventKey) {
          break;
        }

        const shouldHandle = this.handleEvent(event);

        if (shouldHandle) {
          crossChainTransactions.add(event.tx_id);
        }
      }

      if (crossChainTransactions.size > 0) {
        await this.redisHelper.sadd(CacheInfo.CrossChainTransactions().key, ...crossChainTransactions);
      }
    } catch (error) {
      this.logger.error(`An unhandled error occurred when consuming events: ${JSON.stringify(events)}`);
      this.logger.error(error);

      throw error;
    }
  }

  private handleEvent(event: ScEvent): boolean {
    const contractAddress = event.contract_log.contract_id;
    if (contractAddress === this.contractGasServiceStorage) {
      const eventName = getEventType(event);

      const validEvent =
        eventName === Events.NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT ||
        eventName === Events.NATIVE_GAS_ADDED_EVENT ||
        eventName === Events.REFUNDED_EVENT;

      if (validEvent) {
        this.logger.debug('Received Gas Service event from Stacks:');
        this.logger.debug(JSON.stringify(event));
      }

      return validEvent;
    }

    if (contractAddress === this.contractGatewayStorage) {
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
