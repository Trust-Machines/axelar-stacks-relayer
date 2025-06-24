import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiConfigService, CacheInfo, Locker } from '@stacks-monorepo/common';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { getEventType, ScEvent } from '@stacks-monorepo/common/utils';
import {
  LAST_PROCESSED_DATA_TYPE,
  LastProcessedDataRepository,
} from '@stacks-monorepo/common/database/repository/last-processed-data.repository';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { AxiosError } from 'axios';

@Injectable()
export class EventProcessorService {
  private readonly contractGatewayStorage: string;
  private readonly contractGasServiceStorage: string;
  private readonly contractItsStorage: string;

  private readonly logger: Logger;

  constructor(
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly redisHelper: RedisHelper,
    private readonly lastProcessedDataRepository: LastProcessedDataRepository,
    private readonly slackApi: SlackApi,
    apiConfigService: ApiConfigService,
  ) {
    this.contractGatewayStorage = apiConfigService.getContractGatewayStorage();
    this.contractGasServiceStorage = apiConfigService.getContractGasServiceStorage();
    this.contractItsStorage = apiConfigService.getContractItsStorage();

    this.logger = new Logger(EventProcessorService.name);
  }

  // Runs between Axelar EventProcessor crons
  @Cron('3/10 * * * * *')
  async pollEvents() {
    await Locker.lock('eventsPolling', async () => {
      await this.pollEventsRaw();
    });
  }

  async pollEventsRaw() {
    const [gatewayLastProcessedEvent, gasLastProcessedEvent, itsLastProcessedEvent] = await Promise.all([
      this.lastProcessedDataRepository.get(LAST_PROCESSED_DATA_TYPE.LAST_PROCESSED_EVENT_GATEWAY),
      this.lastProcessedDataRepository.get(LAST_PROCESSED_DATA_TYPE.LAST_PROCESSED_EVENT_GAS_SERVICE),
      this.lastProcessedDataRepository.get(LAST_PROCESSED_DATA_TYPE.LAST_PROCESSED_EVENT_ITS),
    ]);

    await Promise.all([
      this.getContractEvents(
        this.contractGatewayStorage,
        LAST_PROCESSED_DATA_TYPE.LAST_PROCESSED_EVENT_GATEWAY,
        gatewayLastProcessedEvent,
      ),
      this.getContractEvents(
        this.contractGasServiceStorage,
        LAST_PROCESSED_DATA_TYPE.LAST_PROCESSED_EVENT_GAS_SERVICE,
        gasLastProcessedEvent,
      ),
      this.getContractEvents(
        this.contractItsStorage,
        LAST_PROCESSED_DATA_TYPE.LAST_PROCESSED_EVENT_ITS,
        itsLastProcessedEvent,
      ),
    ]);
  }

  private async getContractEvents(contractId: string, type: string, lastProcessedEventKey: string | undefined) {
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

        const lastProcessedIndex = events.findIndex(
          (event) => `${event.tx_id}-${event.event_index}` === lastProcessedEventKey,
        );

        const eventsToProcess = lastProcessedIndex !== -1 ? events.slice(0, lastProcessedIndex) : events;

        if (!latestEventKey) {
          latestEventKey = firstEventKey;
        }

        if (eventsToProcess.length > 0) {
          await this.consumeEvents(eventsToProcess);
        }

        // If we found the last processed event on this page, don't go to the next one
        if (lastProcessedIndex !== -1) {
          break;
        }

        offset += limit;
      } catch (e) {
        this.logger.error(`Failed to get events for ${contractId}`, e);

        // Only send Slack notification if not axios error since it pollutes the channel.
        // This can happen only in the case Hiro API is down, and for that there is separate monitoring from infra
        if (!(e instanceof AxiosError)) {
          await this.slackApi.sendError(
            'Event processing error',
            `An unhandled error occurred when consuming events for contract ${contractId}, latest event key ${latestEventKey}`,
          );
        }

        break;
      }
    }

    if (latestEventKey) {
      this.logger.debug(`${contractId} update latest event key to ${latestEventKey}`);
      await this.lastProcessedDataRepository.update(type, latestEventKey);
    }
  }

  async consumeEvents(events: ScEvent[]) {
    try {
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
    } catch (e) {
      this.logger.error(`An unhandled error occurred when consuming events: ${JSON.stringify(events)}`, e);
      await this.slackApi.sendError('Event processing error', `An unhandled error occurred when consuming events...`);

      throw e;
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

    if (contractAddress === this.contractItsStorage) {
      const eventName = getEventType(event);

      const validEvent =
        eventName === Events.INTERCHAIN_TOKEN_DEPLOYMENT_STARTED || eventName === Events.INTERCHAIN_TRANSFER;

      if (validEvent) {
        this.logger.debug('Received ITS event from Stacks:');
        this.logger.debug(JSON.stringify(event));
      }

      return validEvent;
    }

    return false;
  }
}
