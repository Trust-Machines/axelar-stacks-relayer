import { Test, TestingModule } from '@nestjs/testing';
import { GasServiceProcessor } from './gas-service.processor';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { GasServiceContract } from '@stacks-monorepo/common/contracts/gas-service.contract';
import { BinaryUtils } from '@multiversx/sdk-nestjs-common';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { Address, ITransactionEvent } from '@multiversx/sdk-core/out';
import { ApiConfigService, GatewayContract } from '@stacks-monorepo/common';
import { TransactionEvent, TransactionOnNetwork } from '@multiversx/sdk-network-providers/out';
import {
  GasAddedEvent,
  GasPaidForContractCallEvent,
  RefundedEvent,
} from '@stacks-monorepo/common/contracts/entities/gas-service-events';
import BigNumber from 'bignumber.js';
import { Components, GasRefundedEvent } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { ContractCallEvent } from '@stacks-monorepo/common/contracts/entities/gateway-events';
import GasCreditEvent = Components.Schemas.GasCreditEvent;
import { ScEvent } from '../../event-processor/types';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { bufferCV, serializeCV, tupleCV, stringAsciiCV } from '@stacks/transactions';
import { hex } from '@scure/base';

const mockGasContractId = 'mockGasAddress.contract_name';
const mockGatewayContractId = 'mockGatewayAddress.contract_name';

describe('GasServiceProcessor', () => {
  let gasServiceContract: DeepMocked<GasServiceContract>;
  let gatewayContract: DeepMocked<GatewayContract>;
  let apiConfigService: DeepMocked<ApiConfigService>;

  let service: GasServiceProcessor;

  beforeEach(async () => {
    gasServiceContract = createMock();
    gatewayContract = createMock();
    apiConfigService = createMock();

    apiConfigService.getContractGateway.mockReturnValue('mockGatewayAddress');

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

        return null;
      })
      .compile();

    service = module.get<GasServiceProcessor>(GasServiceProcessor);
  });

  it('Should not handle event', () => {
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

    const result = service.handleGasServiceEvent(rawEvent, createMock(), 0, '100');

    expect(result).toBeUndefined();
    expect(gasServiceContract.decodeGasPaidForContractCallEvent).not.toHaveBeenCalled();
    expect(gasServiceContract.decodeNativeGasPaidForContractCallEvent).not.toHaveBeenCalled();
    expect(gasServiceContract.decodeGasAddedEvent).not.toHaveBeenCalled();
    expect(gasServiceContract.decodeNativeGasAddedEvent).not.toHaveBeenCalled();
    expect(gasServiceContract.decodeRefundedEvent).not.toHaveBeenCalled();
  });

  const getMockGasPaid = (
    eventName: string = Events.GAS_PAID_FOR_CONTRACT_CALL_EVENT,
    gasToken: string | null = 'STX',
  ) => {
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
      data: {
        payloadHash: 'ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
        gasToken,
        gasFeeAmount: new BigNumber('654321'),
        refundAddress: 'refundAddress',
      },
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

  function assertEventGasPaidForContractCall(rawEvent: ScEvent, isValid = true, tokenID: string | null = 'STX') {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.CONTRACT_CALL_EVENT),
        }),
      ),
    );

    const transaction = createMock<Transaction>();
    transaction.tx_id = 'txHash';

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

    const result = service.handleGasServiceEvent(rawEvent, transaction, 0, '100');

    if (!isValid) {
      expect(result).toBeUndefined();

      return;
    }

    expect(result).not.toBeUndefined();
    expect(result?.type).toBe('GAS_CREDIT');

    const event = result as GasCreditEvent;

    expect(event.eventID).toBe('0xtxHash-0');
    expect(event.messageID).toBe('0xtxHash-1');
    expect(event.refundAddress).toBe('refundAddress');
    expect(event.payment).toEqual({
      tokenID,
      amount: '654321',
    });
    expect(event.meta).toEqual({
      txID: 'txHash',
      fromAddress: 'senderAddress',
      finalized: true,
    });
  }

  describe('Handle event gas paid for contract call', () => {
    const { rawEvent, event } = getMockGasPaid();

    it('Should handle', () => {
      gasServiceContract.decodeGasPaidForContractCallEvent.mockReturnValueOnce(event);
      gatewayContract.decodeContractCallEvent.mockReturnValueOnce(contractCallEvent);

      assertEventGasPaidForContractCall(rawEvent);
    });

    it('Should not handle if contract call event not found', () => {
      gasServiceContract.decodeGasPaidForContractCallEvent.mockReturnValueOnce(event);

      assertEventGasPaidForContractCall(rawEvent, false);
    });
  });

  describe('Handle event native gas paid for contract call', () => {
    const { rawEvent, event } = getMockGasPaid(Events.NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT, null);

    it('Should handle', () => {
      gasServiceContract.decodeNativeGasPaidForContractCallEvent.mockReturnValueOnce(event);
      gatewayContract.decodeContractCallEvent.mockReturnValueOnce(contractCallEvent);

      assertEventGasPaidForContractCall(rawEvent, true, null);
    });

    it('Should not handle if contract call event not found', () => {
      gasServiceContract.decodeNativeGasPaidForContractCallEvent.mockReturnValueOnce(event);

      assertEventGasPaidForContractCall(rawEvent, false);
    });
  });

  const getMockGasAdded = (eventName: string = Events.GAS_ADDED_EVENT, gasToken: string | null = 'STX') => {
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
      data: {
        gasToken,
        gasFeeAmount: new BigNumber('1000'),
        refundAddress: 'refundAddress',
      },
    };

    return { rawEvent, event };
  };

  function assertGasAddedEvent(rawEvent: ScEvent, tokenID: string | null = 'STX') {
    const transaction = createMock<Transaction>();
    transaction.tx_id = 'txHash';
    transaction.sender_address = 'senderAddress';

    const result = service.handleGasServiceEvent(rawEvent, transaction, 0, '100');

    expect(result).not.toBeUndefined();
    expect(result?.type).toBe('GAS_CREDIT');

    const event = result as GasCreditEvent;

    expect(event.eventID).toBe('0xtxHash-0');
    expect(event.messageID).toBe('0xtxHash-1');
    expect(event.refundAddress).toBe('refundAddress');
    expect(event.payment).toEqual({
      tokenID,
      amount: '1000',
    });
    expect(event.meta).toEqual({
      txID: 'txHash',
      fromAddress: 'senderAddress',
      finalized: true,
    });
  }

  describe('Handle event gas added', () => {
    const { rawEvent, event } = getMockGasAdded();

    it('Should handle', () => {
      gasServiceContract.decodeGasAddedEvent.mockReturnValueOnce(event);

      assertGasAddedEvent(rawEvent);
    });
  });

  describe('Handle event native gas added', () => {
    const { rawEvent, event } = getMockGasAdded(Events.NATIVE_GAS_ADDED_EVENT, null);

    it('Should handle', () => {
      gasServiceContract.decodeNativeGasAddedEvent.mockReturnValueOnce(event);

      assertGasAddedEvent(rawEvent, null);
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
      data: {
        token: null,
        amount: new BigNumber('500'),
        receiver: 'senderAddress',
      },
    };

    it('Should handle', () => {
      gasServiceContract.decodeRefundedEvent.mockReturnValueOnce(refundedEvent);

      const transaction = createMock<Transaction>();
      transaction.tx_id = 'txHash';
      transaction.sender_address = 'senderAddress';

      const result = service.handleGasServiceEvent(rawEvent, transaction, 0, '100');

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('GAS_REFUNDED');

      const event = result as GasRefundedEvent;

      expect(event.eventID).toBe('0xtxHash-0');
      expect(event.messageID).toBe('0xtxHash-1');
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
      });
    });
  });
});
