import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ApiConfigService, CacheInfo } from '@stacks-monorepo/common';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { Test } from '@nestjs/testing';
import { EventProcessorService } from './event.processor.service';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { bufferCV, serializeCV, tupleCV, stringAsciiCV } from '@stacks/transactions';
import { hex } from '@scure/base';

describe('EventProcessorService', () => {
  let redisHelper: DeepMocked<RedisHelper>;
  let apiConfigService: DeepMocked<ApiConfigService>;

  let service: EventProcessorService;

  beforeEach(async () => {
    redisHelper = createMock();
    apiConfigService = createMock();

    apiConfigService.getContractGateway.mockReturnValue('mockGatewayAddress');
    apiConfigService.getContractGasService.mockReturnValue('mockGasAddress');
    apiConfigService.getHiroWsUrl.mockReturnValue('mockHiroWs');

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

        return null;
      })
      .compile();

    service = moduleRef.get(EventProcessorService);
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

      const notification = {
        tx: {
          events: [
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
          ],
        },
      };

      await service.consumeEvents(notification as any);

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

      const notification = {
        tx: {
          events: [
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
          ],
        },
      };

      await service.consumeEvents(notification as any);

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

      const notification = {
        tx: {
          events: [
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
          ],
        },
      };

      await service.consumeEvents(notification as any);

      expect(redisHelper.sadd).not.toHaveBeenCalled();
    });
  });
});
