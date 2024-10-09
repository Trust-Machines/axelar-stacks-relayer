import { ApiConfigService } from '@stacks-monorepo/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { AxelarGmpApi } from '@stacks-monorepo/common/api/axelar.gmp.api';
import { ApiNetworkProvider, TransactionEvent, TransactionOnNetwork } from '@multiversx/sdk-network-providers/out';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { CrossChainTransactionProcessorService } from './cross-chain-transaction.processor.service';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { BinaryUtils } from '@multiversx/sdk-nestjs-common';
import { GasServiceProcessor, GatewayProcessor } from './processors';
import axios from 'axios';
import { ScEvent } from '../event-processor/types';
import { Transaction } from '@stacks/blockchain-api-client/src/types';

const mockTransactionResponse = {
  tx_id: '5cc3bf9866b77b6d05b3756a0faff67d7685058579550989f39cb4319bec0fc1',
  tx_status: 'success',
  fee_rate: '180',
  events: [] as ScEvent[],
  token_transfer: {
    amount: 0,
  },
};

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockGatewayContractId = 'mockGatewayAddress.contract_name';
const mockGasContractId = 'mockGasAddress.gas_contract_name';

describe('CrossChainTransactionProcessor', () => {
  let gatewayProcessor: DeepMocked<GatewayProcessor>;
  let gasServiceProcessor: DeepMocked<GasServiceProcessor>;
  let axelarGmpApi: DeepMocked<AxelarGmpApi>;
  let redisHelper: DeepMocked<RedisHelper>;
  let api: DeepMocked<ApiNetworkProvider>;
  let apiConfigService: DeepMocked<ApiConfigService>;

  let service: CrossChainTransactionProcessorService;

  beforeEach(async () => {
    gatewayProcessor = createMock();
    gasServiceProcessor = createMock();
    axelarGmpApi = createMock();
    redisHelper = createMock();
    api = createMock();
    apiConfigService = createMock();

    apiConfigService.getContractGateway.mockReturnValue('mockGatewayAddress');
    apiConfigService.getContractGasService.mockReturnValue('mockGasAddress');
    apiConfigService.getHiroApiUrl.mockReturnValue('mockHiroUrl');

    const moduleRef = await Test.createTestingModule({
      providers: [CrossChainTransactionProcessorService],
    })
      .useMocker((token) => {
        if (token === GatewayProcessor) {
          return gatewayProcessor;
        }

        if (token === GasServiceProcessor) {
          return gasServiceProcessor;
        }

        if (token === AxelarGmpApi) {
          return axelarGmpApi;
        }

        if (token === RedisHelper) {
          return redisHelper;
        }

        if (token === ApiNetworkProvider) {
          return api;
        }

        if (token === ApiConfigService) {
          return apiConfigService;
        }

        return null;
      })
      .compile();

    service = moduleRef.get(CrossChainTransactionProcessorService);
  });

  it('Should not process pending or failed transaction', async () => {
    redisHelper.smembers.mockReturnValueOnce(Promise.resolve(['txHashNone', 'txHashPending', 'txHashFailed']));

    mockedAxios.get.mockImplementation((url: string) => {
      const urlParts = url.split('/');
      const txHash = urlParts[urlParts.length - 1];

      if (txHash === 'txHashNone') {
        throw new Error('not found');
      }

      const transaction = { ...mockTransactionResponse };
      transaction.tx_id = txHash;

      if (txHash === 'txHashPending') {
        transaction.tx_status = 'pending';
      } else if (txHash === 'txHashFailed') {
        transaction.tx_status = 'failed';
      }

      return Promise.resolve({ data: transaction });
    });

    await service.processCrossChainTransactionsRaw();

    expect(redisHelper.srem).toHaveBeenCalledTimes(1);
    expect(redisHelper.srem).toHaveBeenCalledWith('crossChainTransactions', 'txHashFailed');
    expect(gatewayProcessor.handleGatewayEvent).not.toHaveBeenCalled();
    expect(gasServiceProcessor.handleGasServiceEvent).not.toHaveBeenCalled();
  });

  describe('processCrossChainTransactions', () => {
    const rawGasEvent: ScEvent = {
      event_index: 0,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockGasContractId,
        topic: Events.GAS_PAID_FOR_CONTRACT_CALL_EVENT,
        value: {
          hex: '',
          repr: '',
        },
      },
    };

    const rawGatewayEvent: ScEvent = {
      event_index: 1,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockGatewayContractId,
        topic: Events.CONTRACT_CALL_EVENT,
        value: {
          hex: '',
          repr: '',
        },
      },
    };

    const rawApprovedEvent: ScEvent = {
      event_index: 2,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockGatewayContractId,
        topic: Events.MESSAGE_APPROVED_EVENT,
        value: {
          hex: '',
          repr: '',
        },
      },
    };

    const transaction = { ...mockTransactionResponse };
    transaction.tx_id = 'txHash';
    transaction.tx_status = 'success';
    transaction.fee_rate = '180';
    transaction.token_transfer.amount = 0;

    it('Should handle multiple events', async () => {
      transaction.events = [rawGasEvent, rawGatewayEvent];

      redisHelper.smembers.mockReturnValueOnce(Promise.resolve(['txHash']));
      mockedAxios.get.mockResolvedValueOnce({
        data: transaction,
      });

      await service.processCrossChainTransactionsRaw();

      expect(gasServiceProcessor.handleGasServiceEvent).toHaveBeenCalledTimes(1);
      expect(gasServiceProcessor.handleGasServiceEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        0,
        '180',
      );

      expect(gatewayProcessor.handleGatewayEvent).toHaveBeenCalledTimes(1);
      expect(gatewayProcessor.handleGatewayEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        1,
        '180',
        '0',
      );

      expect(axelarGmpApi.postEvents).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.postEvents).toHaveBeenCalledWith(expect.anything(), 'txHash');
      expect(redisHelper.srem).toHaveBeenCalledWith('crossChainTransactions', 'txHash');
    });

    it('Should handle multiple approval events and set cost for each', async () => {
      transaction.events = [rawApprovedEvent, rawApprovedEvent];

      redisHelper.smembers.mockReturnValueOnce(Promise.resolve(['txHash']));
      mockedAxios.get.mockReturnValueOnce(Promise.resolve({ data: transaction }));

      gatewayProcessor.handleGatewayEvent.mockReturnValue(
        Promise.resolve({
          eventID: '0xtxHash-1',
          message: {
            messageID: '',
            payloadHash: '',
            destinationAddress: '',
            sourceAddress: '',
            sourceChain: '',
          },
          cost: {
            amount: '0', // Will be overwritten
          },
          type: 'MESSAGE_APPROVED',
        }),
      );

      await service.processCrossChainTransactionsRaw();

      expect(gatewayProcessor.handleGatewayEvent).toHaveBeenCalledTimes(2);
      expect(gatewayProcessor.handleGatewayEvent).toHaveBeenCalledWith(
        rawApprovedEvent,
        expect.anything(),
        1,
        '180',
        '0',
      );

      expect(axelarGmpApi.postEvents).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.postEvents).toHaveBeenCalledWith(expect.anything(), 'txHash');
      expect(axelarGmpApi.postEvents.mock.lastCall?.[0]).toHaveLength(2);

      // Assert gas was correctly calculated for each event
      // @ts-ignore
      expect(axelarGmpApi.postEvents.mock.lastCall?.[0][0].cost.amount).toBe('90');
      // @ts-ignore
      expect(axelarGmpApi.postEvents.mock.lastCall?.[0][1].cost.amount).toBe('90');

      expect(redisHelper.srem).toHaveBeenCalledTimes(1);
      expect(redisHelper.srem).toHaveBeenCalledWith('crossChainTransactions', 'txHash');
    });

    it('Should not postEvents if no events to send', async () => {
      transaction.events = [];

      redisHelper.smembers.mockReturnValueOnce(Promise.resolve(['txHash']));
      mockedAxios.get.mockReturnValueOnce(Promise.resolve({ data: transaction }));

      await service.processCrossChainTransactionsRaw();

      expect(gasServiceProcessor.handleGasServiceEvent).not.toHaveBeenCalled();
      expect(gatewayProcessor.handleGatewayEvent).not.toHaveBeenCalled();
      expect(axelarGmpApi.postEvents).not.toHaveBeenCalled();
      expect(redisHelper.srem).toHaveBeenCalledWith('crossChainTransactions', 'txHash');
    });

    it('Should handle postEvents error', async () => {
      transaction.events = [rawGasEvent];

      redisHelper.smembers.mockReturnValueOnce(Promise.resolve(['txHash']));
      mockedAxios.get.mockReturnValueOnce(Promise.resolve({ data: transaction }));

      axelarGmpApi.postEvents.mockRejectedValueOnce('Network error');

      await service.processCrossChainTransactionsRaw();

      expect(gasServiceProcessor.handleGasServiceEvent).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.postEvents).toHaveBeenCalledTimes(1);
      expect(redisHelper.srem).not.toHaveBeenCalled(); // Should not remove the tx in case of an error
    });
  });
});
