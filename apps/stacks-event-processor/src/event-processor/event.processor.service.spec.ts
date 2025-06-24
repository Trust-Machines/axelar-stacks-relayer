import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ApiConfigService, CacheInfo } from '@stacks-monorepo/common';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { Test } from '@nestjs/testing';
import { EventProcessorService } from './event.processor.service';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { bufferCV, serializeCV, tupleCV, stringAsciiCV } from '@stacks/transactions';
import { hex } from '@scure/base';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { ScEvent } from '@stacks-monorepo/common/utils';
import { LastProcessedDataRepository } from '@stacks-monorepo/common/database/repository/last-processed-data.repository';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

describe('EventProcessorService', () => {
  let redisHelper: DeepMocked<RedisHelper>;
  let apiConfigService: DeepMocked<ApiConfigService>;
  let hiroApiHelper: DeepMocked<HiroApiHelper>;
  let lastProcessedDataRepository: DeepMocked<LastProcessedDataRepository>;
  let slackApi: DeepMocked<SlackApi>;

  let service: EventProcessorService;

  beforeEach(async () => {
    redisHelper = createMock();
    apiConfigService = createMock();
    hiroApiHelper = createMock();
    lastProcessedDataRepository = createMock();
    slackApi = createMock();

    apiConfigService.getContractGatewayStorage.mockReturnValue('mockGatewayAddress.contract_name');
    apiConfigService.getContractGasServiceStorage.mockReturnValue('mockGasAddress.contract_name');
    apiConfigService.getContractItsStorage.mockReturnValue('mockItsAddress.contract_name');

    const moduleRef = await Test.createTestingModule({
      providers: [EventProcessorService],
    })
      .useMocker((token) => {
        if (token === RedisHelper) {
          return redisHelper;
        }

        if (token === ApiConfigService) {
          return apiConfigService;
        }

        if (token === HiroApiHelper) {
          return hiroApiHelper;
        }

        if (token === LastProcessedDataRepository) {
          return lastProcessedDataRepository;
        }

        if (token === SlackApi) {
          return slackApi;
        }

        return null;
      })
      .compile();

    service = moduleRef.get(EventProcessorService);
  });

  describe('pollEvents', () => {
    it('Should poll events from beginning', async () => {
      lastProcessedDataRepository.get.mockResolvedValue(undefined);

      hiroApiHelper.getContractEvents.mockImplementation((contractId, offset) => {
        if (offset === 0) {
          return Promise.resolve([
            {
              event_type: 'smart_contract_log',
              event_index: 0,
              tx_id: contractId,
              contract_log: {
                contract_id: 'test',
                topic: '',
                value: {
                  hex: '0x',
                  repr: '',
                },
              },
            },
          ]);
        }

        return Promise.resolve([]);
      });

      await service.pollEventsRaw();

      expect(hiroApiHelper.getContractEvents).toHaveBeenCalledTimes(6);

      expect(lastProcessedDataRepository.get).toHaveBeenCalledTimes(3);
      expect(lastProcessedDataRepository.get).toHaveBeenCalledWith('lastProcessedEvent:gateway');
      expect(lastProcessedDataRepository.get).toHaveBeenCalledWith('lastProcessedEvent:gas-service');
      expect(lastProcessedDataRepository.get).toHaveBeenCalledWith('lastProcessedEvent:its');

      expect(lastProcessedDataRepository.update).toHaveBeenCalledTimes(3);
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith(
        'lastProcessedEvent:gateway',
        'mockGatewayAddress.contract_name-0',
      );
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith(
        'lastProcessedEvent:gas-service',
        'mockGasAddress.contract_name-0',
      );
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith(
        'lastProcessedEvent:its',
        'mockItsAddress.contract_name-0',
      );
    });

    it('Should poll events from existing no new', async () => {
      lastProcessedDataRepository.get.mockResolvedValue('txId-0');

      hiroApiHelper.getContractEvents.mockImplementation((_, offset) => {
        if (offset === 0) {
          return Promise.resolve([
            {
              event_type: 'smart_contract_log',
              event_index: 0,
              tx_id: 'txId',
              contract_log: {
                contract_id: 'test',
                topic: '',
                value: {
                  hex: '0x',
                  repr: '',
                },
              },
            },
          ]);
        }

        return Promise.resolve([]);
      });

      await service.pollEventsRaw();

      expect(hiroApiHelper.getContractEvents).toHaveBeenCalledTimes(3);

      expect(lastProcessedDataRepository.get).toHaveBeenCalledTimes(3);
      expect(lastProcessedDataRepository.get).toHaveBeenCalledWith('lastProcessedEvent:gateway');
      expect(lastProcessedDataRepository.get).toHaveBeenCalledWith('lastProcessedEvent:gas-service');
      expect(lastProcessedDataRepository.get).toHaveBeenCalledWith('lastProcessedEvent:its');

      expect(lastProcessedDataRepository.update).not.toHaveBeenCalled();
    });

    it('Should poll events from existing with new events', async () => {
      lastProcessedDataRepository.get.mockResolvedValue('txId-0');

      hiroApiHelper.getContractEvents.mockImplementation((_, offset) => {
        if (offset === 0) {
          return Promise.resolve([
            {
              event_type: 'smart_contract_log',
              event_index: 0,
              tx_id: 'txId2', // this will be processed
              contract_log: {
                contract_id: 'test',
                topic: '',
                value: {
                  hex: '0x',
                  repr: '',
                },
              },
            },
            {
              event_type: 'smart_contract_log',
              event_index: 0,
              tx_id: 'txId', // this will not be processed
              contract_log: {
                contract_id: 'test',
                topic: '',
                value: {
                  hex: '0x',
                  repr: '',
                },
              },
            },
          ]);
        }

        return Promise.resolve([]);
      });

      await service.pollEventsRaw();

      expect(hiroApiHelper.getContractEvents).toHaveBeenCalledTimes(3);

      expect(lastProcessedDataRepository.get).toHaveBeenCalledTimes(3);
      expect(lastProcessedDataRepository.get).toHaveBeenCalledWith('lastProcessedEvent:gateway');
      expect(lastProcessedDataRepository.get).toHaveBeenCalledWith('lastProcessedEvent:gas-service');
      expect(lastProcessedDataRepository.get).toHaveBeenCalledWith('lastProcessedEvent:its');

      expect(lastProcessedDataRepository.update).toHaveBeenCalledTimes(3);
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith('lastProcessedEvent:gateway', 'txId2-0');
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith('lastProcessedEvent:gas-service', 'txId2-0');
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith('lastProcessedEvent:its', 'txId2-0');
    });
  });

  describe('consumeEvents', () => {
    it('Should handle gateway event correctly', async () => {
      const message = bufferCV(
        serializeCV(
          tupleCV({
            type: stringAsciiCV(Events.CONTRACT_CALL_EVENT),
          }),
        ),
      );

      const events: ScEvent[] = [
        {
          event_type: 'smart_contract_log',
          event_index: 0,
          tx_id: 'txHash',
          contract_log: {
            contract_id: 'mockGatewayAddress.contract_name',
            topic: 'print',
            value: {
              hex: `0x${hex.encode(message.buffer)}`,
              repr: '',
            },
          },
        },
      ];

      await service.consumeEvents(events);

      expect(redisHelper.sadd).toHaveBeenCalledTimes(1);
      expect(redisHelper.sadd).toHaveBeenCalledWith(CacheInfo.CrossChainTransactions().key, 'txHash');
    });

    it('Should handle gas service event correctly', async () => {
      const message = bufferCV(
        serializeCV(
          tupleCV({
            type: stringAsciiCV(Events.NATIVE_GAS_ADDED_EVENT),
          }),
        ),
      );

      const events: ScEvent[] = [
        {
          event_type: 'smart_contract_log',
          event_index: 0,
          tx_id: 'txHash',
          contract_log: {
            contract_id: 'mockGasAddress.contract_name',
            topic: 'print',
            value: {
              hex: `0x${hex.encode(message.buffer)}`,
              repr: '',
            },
          },
        },
      ];

      await service.consumeEvents(events);

      expect(redisHelper.sadd).toHaveBeenCalledTimes(1);
      expect(redisHelper.sadd).toHaveBeenCalledWith(CacheInfo.CrossChainTransactions().key, 'txHash');
    });

    it('Should handle ITS event correctly', async () => {
      const message = bufferCV(
        serializeCV(
          tupleCV({
            type: stringAsciiCV(Events.INTERCHAIN_TOKEN_DEPLOYMENT_STARTED),
          }),
        ),
      );

      const events: ScEvent[] = [
        {
          event_type: 'smart_contract_log',
          event_index: 0,
          tx_id: 'txHash',
          contract_log: {
            contract_id: 'mockItsAddress.contract_name',
            topic: 'print',
            value: {
              hex: `0x${hex.encode(message.buffer)}`,
              repr: '',
            },
          },
        },
      ];

      await service.consumeEvents(events);

      expect(redisHelper.sadd).toHaveBeenCalledTimes(1);
      expect(redisHelper.sadd).toHaveBeenCalledWith(CacheInfo.CrossChainTransactions().key, 'txHash');
    });

    it('Should not consume invalid events', async () => {
      const message = bufferCV(
        serializeCV(
          tupleCV({
            type: stringAsciiCV('unrelated_event'),
          }),
        ),
      );

      const events: ScEvent[] = [
        {
          event_type: 'smart_contract_log',
          event_index: 0,
          tx_id: 'txHash',
          contract_log: {
            contract_id: 'someOtherAddress',
            topic: 'print',
            value: {
              hex: `0x${hex.encode(message.buffer)}`,
              repr: '',
            },
          },
        },
      ];

      await service.consumeEvents(events);

      expect(redisHelper.sadd).not.toHaveBeenCalled();
    });
  });
});
