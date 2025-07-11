import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { hex } from '@scure/base';
import { ApiConfigService, GatewayContract, ScEvent } from '@stacks-monorepo/common';
import { Components, GasRefundedEvent } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import {
  GasAddedEvent,
  GasPaidForContractCallEvent,
  RefundedEvent,
} from '@stacks-monorepo/common/contracts/entities/gas-service-events';
import { ContractCallEvent } from '@stacks-monorepo/common/contracts/entities/gateway-events';
import { GasServiceContract } from '@stacks-monorepo/common/contracts/gas-service.contract';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { bufferCV, serializeCV, stringAsciiCV, tupleCV } from '@stacks/transactions';
import BigNumber from 'bignumber.js';
import { GasServiceProcessor } from './gas-service.processor';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { StacksTransactionRepository } from '@stacks-monorepo/common/database/repository/stacks-transaction.repository';
import GasCreditEvent = Components.Schemas.GasCreditEvent;

const mockGasContractId = 'mockGasAddress.contract_name';
const mockGatewayContractId = 'mockGatewayAddress.contract_name';

describe('GasServiceProcessor', () => {
  let gasServiceContract: DeepMocked<GasServiceContract>;
  let gatewayContract: DeepMocked<GatewayContract>;
  let apiConfigService: DeepMocked<ApiConfigService>;
  let slackApi: DeepMocked<SlackApi>;
  let stacksTransactionRepository: DeepMocked<StacksTransactionRepository>;

  let service: GasServiceProcessor;

  beforeEach(async () => {
    gasServiceContract = createMock();
    gatewayContract = createMock();
    apiConfigService = createMock();
    slackApi = createMock();
    stacksTransactionRepository = createMock();

    apiConfigService.getContractGatewayStorage.mockReturnValue(mockGatewayContractId);

    const module: TestingModule = await Test.createTestingModule({
      providers: [GasServiceProcessor],
    })
      .useMocker((token) => {
        if (token === GasServiceContract) {
          return gasServiceContract;
        }

        if (token === GatewayContract) {
          return gatewayContract;
        }

        if (token === ApiConfigService) {
          return apiConfigService;
        }

        if (token === SlackApi) {
          return slackApi;
        }

        if (token === StacksTransactionRepository) {
          return stacksTransactionRepository;
        }

        return null;
      })
      .compile();

    service = module.get<GasServiceProcessor>(GasServiceProcessor);
  });

  it('Should not handle event', async () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.CONTRACT_CALL_EVENT),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockGasContractId,
        topic: 'print',
        value: {
          hex: `0x${hex.encode(message.buffer)}`,
          repr: '',
        },
      },
    };

    const result = await service.handleGasServiceEvent(rawEvent, createMock(), 0, 0, '100');

    expect(result).toBeUndefined();
    expect(gasServiceContract.decodeNativeGasPaidForContractCallEvent).not.toHaveBeenCalled();
    expect(gasServiceContract.decodeNativeGasAddedEvent).not.toHaveBeenCalled();
    expect(gasServiceContract.decodeRefundedEvent).not.toHaveBeenCalled();
  });

  const getMockGasPaid = (eventName: string = Events.NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT) => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(eventName),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockGasContractId,
        topic: 'print',
        value: {
          hex: `0x${hex.encode(message.buffer)}`,
          repr: '',
        },
      },
    };

    const event: GasPaidForContractCallEvent = {
      sender: 'senderAddress',
      destinationChain: 'ethereum',
      destinationAddress: 'destinationAddress',
      payloadHash: 'ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
      amount: new BigNumber('654321'),
      refundAddress: 'refundAddress',
    };

    return { rawEvent, event };
  };

  const contractCallEvent: ContractCallEvent = {
    sender: 'senderAddress',
    destinationChain: 'ethereum',
    destinationAddress: 'destinationAddress',
    payloadHash: 'ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
    payload: Buffer.from('payload'),
  };

  async function assertEventGasPaidForContractCall(rawEvent: ScEvent, isValid = true, tokenID: string | null = 'STX') {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.CONTRACT_CALL_EVENT),
        }),
      ),
    );

    const transaction = createMock<Transaction>();
    transaction.tx_id = 'txHash';
    transaction.block_time_iso = '11.05.2024';

    if (isValid) {
      transaction.events = [
        rawEvent,
        {
          event_index: 1,
          event_type: 'smart_contract_log',
          tx_id: 'txHash',
          contract_log: {
            contract_id: mockGatewayContractId,
            topic: 'print',
            value: {
              hex: `0x${hex.encode(message.buffer)}`,
              repr: '',
            },
          },
        },
      ];
    } else {
      transaction.events = [];
    }

    const result = await service.handleGasServiceEvent(rawEvent, transaction, 0, 0, '100');

    if (!isValid) {
      expect(result).toBeUndefined();

      return;
    }

    expect(result).not.toBeUndefined();
    expect(result?.type).toBe('GAS_CREDIT');

    const event = result as GasCreditEvent;

    expect(event.eventID).toBe('txHash-0');
    expect(event.messageID).toBe('txHash-1');
    expect(event.refundAddress).toBe('refundAddress');
    expect(event.payment).toEqual({
      tokenID,
      amount: '654321',
    });
    expect(event.meta).toEqual({
      txID: 'txHash',
      fromAddress: 'senderAddress',
      finalized: true,
      timestamp: '11.05.2024',
    });
  }

  describe('Handle event native gas paid for contract call', () => {
    const { rawEvent, event } = getMockGasPaid(Events.NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT);

    it('Should handle', async () => {
      gasServiceContract.decodeNativeGasPaidForContractCallEvent.mockReturnValueOnce(event);
      gatewayContract.decodeContractCallEvent.mockReturnValueOnce(contractCallEvent);

      await assertEventGasPaidForContractCall(rawEvent, true, null);
    });

    it('Should not handle if contract call event not found', async () => {
      gasServiceContract.decodeNativeGasPaidForContractCallEvent.mockReturnValueOnce(event);

      await assertEventGasPaidForContractCall(rawEvent, false);
    });
  });

  const getMockGasAdded = (eventName: string = Events.NATIVE_GAS_ADDED_EVENT) => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(eventName),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockGasContractId,
        topic: 'print',
        value: {
          hex: `0x${hex.encode(message.buffer)}`,
          repr: '',
        },
      },
    };

    const event: GasAddedEvent = {
      txHash: 'txHash',
      logIndex: 1,
      amount: new BigNumber('1000'),
      refundAddress: 'refundAddress',
    };

    return { rawEvent, event };
  };

  async function assertGasAddedEvent(rawEvent: ScEvent, tokenID: string | null = 'STX') {
    const transaction = createMock<Transaction>();
    transaction.tx_id = 'txHash';
    transaction.sender_address = 'senderAddress';
    transaction.block_time_iso = '11.05.2024';

    const result = await service.handleGasServiceEvent(rawEvent, transaction, 0, 0, '100');

    expect(result).not.toBeUndefined();
    expect(result?.type).toBe('GAS_CREDIT');

    const event = result as GasCreditEvent;

    expect(event.eventID).toBe('txHash-0');
    expect(event.messageID).toBe('txHash-1');
    expect(event.refundAddress).toBe('refundAddress');
    expect(event.payment).toEqual({
      tokenID,
      amount: '1000',
    });
    expect(event.meta).toEqual({
      txID: 'txHash',
      fromAddress: 'senderAddress',
      finalized: true,
      timestamp: '11.05.2024',
    });
  }

  describe('Handle event native gas added', () => {
    const { rawEvent, event } = getMockGasAdded(Events.NATIVE_GAS_ADDED_EVENT);

    it('Should handle', async () => {
      gasServiceContract.decodeNativeGasAddedEvent.mockReturnValueOnce(event);

      await assertGasAddedEvent(rawEvent, null);
    });
  });

  describe('Handle event refunded', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.REFUNDED_EVENT),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockGasContractId,
        topic: 'print',
        value: {
          hex: `0x${hex.encode(message.buffer)}`,
          repr: '',
        },
      },
    };

    const refundedEvent: RefundedEvent = {
      txHash: 'txHash',
      logIndex: 1,
      amount: new BigNumber('500'),
      receiver: 'senderAddress',
    };

    it('Should handle without StacksTransaction', async () => {
      gasServiceContract.decodeRefundedEvent.mockReturnValueOnce(refundedEvent);
      stacksTransactionRepository.updateStatusIfItExists.mockResolvedValueOnce(false);

      const transaction = createMock<Transaction>();
      transaction.tx_id = 'txHash';
      transaction.sender_address = 'senderAddress';
      transaction.block_time_iso = '11.05.2024';

      const result = await service.handleGasServiceEvent(rawEvent, transaction, 0, 0, '100');

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('GAS_REFUNDED');

      const event = result as GasRefundedEvent;

      expect(event.eventID).toBe('txHash-0');
      expect(event.messageID).toBe('txHash-1');
      expect(event.recipientAddress).toBe('senderAddress');
      expect(event.refundedAmount).toEqual({
        tokenID: null,
        amount: '500',
      });
      expect(event.cost).toEqual({
        amount: '100',
      });
      expect(event.meta).toEqual({
        txID: 'txHash',
        fromAddress: 'senderAddress',
        finalized: true,
        timestamp: '11.05.2024',
      });
      expect(stacksTransactionRepository.updateStatusIfItExists).toHaveBeenCalledTimes(1);
    });

    it('Should handle with StacksTransaction', async () => {
      gasServiceContract.decodeRefundedEvent.mockReturnValueOnce(refundedEvent);

      stacksTransactionRepository.updateStatusIfItExists.mockResolvedValueOnce(true);

      const transaction = createMock<Transaction>();
      transaction.tx_id = '0xtxHashRefund';
      transaction.sender_address = 'senderAddress';
      transaction.block_time_iso = '11.05.2024';

      const result = await service.handleGasServiceEvent(rawEvent, transaction, 0, 0, '100');

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('GAS_REFUNDED');

      const event = result as GasRefundedEvent;

      expect(event.eventID).toBe('0xtxHashRefund-0');
      expect(event.messageID).toBe('txHash-1');
      expect(event.recipientAddress).toBe('senderAddress');
      expect(event.refundedAmount).toEqual({
        tokenID: null,
        amount: '500',
      });
      expect(event.cost).toEqual({
        amount: '100',
      });
      expect(event.meta).toEqual({
        txID: '0xtxHashRefund',
        fromAddress: 'senderAddress',
        finalized: true,
        timestamp: '11.05.2024',
      });
      expect(stacksTransactionRepository.updateStatusIfItExists).toHaveBeenCalledTimes(1);
      expect(stacksTransactionRepository.updateStatusIfItExists).toHaveBeenCalledWith(
        'REFUND',
        'txHashRefund',
        'SUCCESS',
      );
    });
  });
});
