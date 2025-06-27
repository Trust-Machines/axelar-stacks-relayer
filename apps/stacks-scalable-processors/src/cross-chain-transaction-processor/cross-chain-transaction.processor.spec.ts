import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { ApiConfigService, ScEvent } from '@stacks-monorepo/common';
import { AxelarGmpApi } from '@stacks-monorepo/common/api/axelar.gmp.api';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { CrossChainTransactionProcessorService } from './cross-chain-transaction.processor.service';
import { GasServiceProcessor, GatewayProcessor, ItsProcessor } from './processors';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { CrossChainTransactionRepository } from '@stacks-monorepo/common/database/repository/cross-chain-transaction.repository';

const mockTransactionResponse = {
  tx_id: '5cc3bf9866b77b6d05b3756a0faff67d7685058579550989f39cb4319bec0fc1',
  tx_status: 'success',
  fee_rate: '180',
  events: [] as ScEvent[],
  token_transfer: {
    amount: 0,
  },
};

const mockGatewayContractId = 'mockGatewayAddress.contract_name';
const mockGasContractId = 'mockGasAddress.gas_contract_name';
const mockItsContractId = 'mockItsAddress.its_contract_name';

describe('CrossChainTransactionProcessor', () => {
  let gatewayProcessor: DeepMocked<GatewayProcessor>;
  let gasServiceProcessor: DeepMocked<GasServiceProcessor>;
  let itsProcessor: DeepMocked<ItsProcessor>;
  let axelarGmpApi: DeepMocked<AxelarGmpApi>;
  let crossChainTransactionRepository: DeepMocked<CrossChainTransactionRepository>;
  let apiConfigService: DeepMocked<ApiConfigService>;
  let hiroApi: DeepMocked<HiroApiHelper>;
  let slackApi: DeepMocked<SlackApi>;

  let service: CrossChainTransactionProcessorService;

  beforeEach(async () => {
    gatewayProcessor = createMock();
    gasServiceProcessor = createMock();
    itsProcessor = createMock();
    axelarGmpApi = createMock();
    crossChainTransactionRepository = createMock();
    apiConfigService = createMock();
    hiroApi = createMock();
    slackApi = createMock();

    apiConfigService.getContractGatewayStorage.mockReturnValue(mockGatewayContractId);
    apiConfigService.getContractGasServiceStorage.mockReturnValue(mockGasContractId);
    apiConfigService.getContractItsStorage.mockReturnValue(mockItsContractId);

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

        if (token === ItsProcessor) {
          return itsProcessor;
        }

        if (token === AxelarGmpApi) {
          return axelarGmpApi;
        }

        if (token === CrossChainTransactionRepository) {
          return crossChainTransactionRepository;
        }

        if (token === ApiConfigService) {
          return apiConfigService;
        }

        if (token === HiroApiHelper) {
          return hiroApi;
        }

        if (token === SlackApi) {
          return slackApi;
        }

        return null;
      })
      .compile();

    service = moduleRef.get(CrossChainTransactionProcessorService);
  });

  it('Should not process pending or failed transaction', async () => {
    hiroApi.getTransactionWithFee.mockImplementation((txHash: string) => {
      if (txHash === 'txHashNone') {
        throw new Error('not found');
      }

      const transaction = { ...(mockTransactionResponse as any) };
      transaction.tx_id = txHash;

      if (txHash === 'txHashPending') {
        transaction.tx_status = 'pending';
      } else if (txHash === 'txHashFailed') {
        transaction.tx_status = 'failed';
      }

      return Promise.resolve({ transaction, fee: transaction.fee_rate });
    });

    await service.processCrossChainTransactionsRaw(['txHashNone', 'txHashPending', 'txHashFailed']);

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
        topic: Events.NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT,
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

    const rawItsEvent: ScEvent = {
      event_index: 3,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockItsContractId,
        topic: Events.INTERCHAIN_TOKEN_DEPLOYMENT_STARTED,
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

    const transaction = { ...(mockTransactionResponse as any) };
    transaction.tx_id = 'txHash';
    transaction.tx_status = 'success';
    transaction.fee_rate = '180';
    transaction.token_transfer.amount = 0;

    it('Should handle multiple events', async () => {
      transaction.events = [rawGasEvent, rawGatewayEvent, rawItsEvent];

      hiroApi.getTransactionWithFee.mockResolvedValueOnce({
        transaction: transaction,
        fee: transaction.fee_rate,
      });

      await service.processCrossChainTransactionsRaw(['txHash']);

      expect(gasServiceProcessor.handleGasServiceEvent).toHaveBeenCalledTimes(1);
      expect(gasServiceProcessor.handleGasServiceEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        0,
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

      expect(itsProcessor.handleItsEvent).toHaveBeenCalledTimes(1);
      expect(itsProcessor.handleItsEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), 3);

      expect(axelarGmpApi.postEvents).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.postEvents).toHaveBeenCalledWith(expect.anything(), 'txHash');
    });

    it('Should handle multiple approval events and set cost for each', async () => {
      transaction.events = [rawApprovedEvent, rawApprovedEvent];

      hiroApi.getTransactionWithFee.mockResolvedValueOnce({
        transaction: transaction,
        fee: transaction.fee_rate,
      });

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

      await service.processCrossChainTransactionsRaw(['txHash']);

      expect(gatewayProcessor.handleGatewayEvent).toHaveBeenCalledTimes(2);
      expect(gatewayProcessor.handleGatewayEvent).toHaveBeenCalledWith(
        rawApprovedEvent,
        expect.anything(),
        2,
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
    });

    it('Should not postEvents if no events to send', async () => {
      transaction.events = [];

      hiroApi.getTransactionWithFee.mockResolvedValueOnce({
        transaction: transaction,
        fee: transaction.fee_rate,
      });

      await service.processCrossChainTransactionsRaw(['txHash']);

      expect(gasServiceProcessor.handleGasServiceEvent).not.toHaveBeenCalled();
      expect(gatewayProcessor.handleGatewayEvent).not.toHaveBeenCalled();
      expect(axelarGmpApi.postEvents).not.toHaveBeenCalled();
    });

    it('Should handle postEvents error', async () => {
      transaction.events = [rawGasEvent];

      hiroApi.getTransactionWithFee.mockResolvedValueOnce({
        transaction: transaction,
        fee: transaction.fee_rate,
      });

      axelarGmpApi.postEvents.mockRejectedValueOnce('Network error');

      await service.processCrossChainTransactionsRaw(['txHash']);

      expect(gasServiceProcessor.handleGasServiceEvent).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.postEvents).toHaveBeenCalledTimes(1);
    });
  });
});
