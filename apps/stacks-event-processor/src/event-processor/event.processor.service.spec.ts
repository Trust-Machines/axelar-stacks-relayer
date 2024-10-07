import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ApiConfigService, CacheInfo } from '@mvx-monorepo/common';
import { RedisHelper } from '@mvx-monorepo/common/helpers/redis.helper';
import { Test } from '@nestjs/testing';
import { EventProcessorService } from './event.processor.service';

describe('EventProcessorService', () => {
  let redisHelper: DeepMocked<RedisHelper>;
  let apiConfigService: DeepMocked<ApiConfigService>;

  let service: EventProcessorService;

  beforeEach(async () => {
    redisHelper = createMock();
    apiConfigService = createMock();

    apiConfigService.getContractGateway.mockReturnValue('mockGatewayAddress');
    apiConfigService.getContractGasService.mockReturnValue('mockGasServiceAddress');
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
      const notification = {
        tx: {
          events: [
            {
              event_type: 'smart_contract_log',
              event_index: 0,
              tx_id: 'txHash',
              contract_log: {
                contract_id: 'mockGatewayAddress',
                topic: 'contract_call_event',
                value: {
                  hex: 'mockHexValue',
                  repr: 'mockReprValue',
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
      const notification = {
        tx: {
          events: [
            {
              event_type: 'smart_contract_log',
              event_index: 0,
              tx_id: 'txHash',
              contract_log: {
                contract_id: 'mockGasServiceAddress',
                topic: 'gas_paid_for_contract_call_event',
                value: {
                  hex: 'mockHexValue',
                  repr: 'mockReprValue',
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
      const notification = {
        tx: {
          events: [
            {
              event_type: 'smart_contract_log',
              event_index: 0,
              tx_id: 'txHash',
              contract_log: {
                contract_id: 'someOtherAddress',
                topic: 'unrelated_event',
                value: {
                  hex: 'mockHexValue',
                  repr: 'mockReprValue',
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
