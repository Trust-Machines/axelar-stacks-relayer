import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { MessageApproved, MessageApprovedStatus } from '@prisma/client';
import { hex } from '@scure/base';
import { Components, SignersRotatedEvent } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import {
  ContractCallEvent,
  MessageApprovedEvent,
  MessageExecutedEvent,
  WeightedSignersEvent,
} from '@stacks-monorepo/common/contracts/entities/gateway-events';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { bufferCV, serializeCV, stringAsciiCV, tupleCV } from '@stacks/transactions';
import BigNumber from 'bignumber.js';
import { GatewayProcessor } from './gateway.processor';
import CallEvent = Components.Schemas.CallEvent;
import MessageApprovedEventApi = Components.Schemas.MessageApprovedEvent;
import MessageExecutedEventApi = Components.Schemas.MessageExecutedEvent;
import { ApiConfigService, BinaryUtils, ScEvent } from '@stacks-monorepo/common';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

const mockGatewayContractId = 'SP6P4EJF0VG8V0RB3TQQKJBHDQKEF6NVRD1KZE3C.contract_name';

describe('GatewayProcessor', () => {
  let gatewayContract: DeepMocked<GatewayContract>;
  let messageApprovedRepository: DeepMocked<MessageApprovedRepository>;
  let apiConfigService: DeepMocked<ApiConfigService>;
  let slackApi: DeepMocked<SlackApi>;

  let service: GatewayProcessor;

  const contractCallEvent: ContractCallEvent = {
    sender: 'senderAddress',
    destinationChain: 'ethereum',
    destinationAddress: 'destinationAddress',
    payloadHash: 'ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
    payload: Buffer.from('payload'),
  };
  const messageApprovedEvent: MessageApprovedEvent = {
    commandId: '0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da',
    sourceChain: 'ethereum',
    messageId: 'messageId',
    sourceAddress: 'sourceAddress',
    contractAddress: 'SP6P4EJF0VG8V0RB3TQQKJBHDQKEF6NVRD1KZE3C',
    payloadHash: 'ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
  };
  const messageExecutedEvent: MessageExecutedEvent = {
    commandId: '0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da',
    sourceChain: 'ethereum',
    messageId: 'messageId',
  };
  const weightedSigners: WeightedSignersEvent = {
    signers: [
      {
        signer: '',
        weight: new BigNumber('1'),
      },
    ],
    threshold: new BigNumber('1'),
    nonce: '1234',
    epoch: 1,
    signersHash: Buffer.from('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7', 'base64'),
  };

  beforeEach(async () => {
    gatewayContract = createMock();
    messageApprovedRepository = createMock();
    apiConfigService = createMock();
    slackApi = createMock();

    const moduleRef = await Test.createTestingModule({
      providers: [GatewayProcessor],
    })
      .useMocker((token) => {
        if (token === GatewayContract) {
          return gatewayContract;
        }

        if (token === MessageApprovedRepository) {
          return messageApprovedRepository;
        }

        if (token === ApiConfigService) {
          return apiConfigService;
        }

        if (token === SlackApi) {
          return slackApi;
        }

        return null;
      })
      .compile();

    gatewayContract.decodeMessageApprovedEvent.mockReturnValue(messageApprovedEvent);
    gatewayContract.decodeMessageExecutedEvent.mockReturnValue(messageExecutedEvent);
    apiConfigService.getContractItsProxy.mockReturnValue('mock_contract.mock_name');

    service = moduleRef.get(GatewayProcessor);
  });

  it('Should not handle event', async () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
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
    };

    const result = await service.handleGatewayEvent(rawEvent, createMock(), 0, '100', '0');

    expect(result).toBeUndefined();
    expect(gatewayContract.decodeContractCallEvent).not.toHaveBeenCalled();
    expect(gatewayContract.decodeMessageApprovedEvent).not.toHaveBeenCalled();
    expect(gatewayContract.decodeMessageExecutedEvent).not.toHaveBeenCalled();
    expect(gatewayContract.decodeSignersRotatedEvent).not.toHaveBeenCalled();
  });

  describe('handleContractCallEvent', () => {
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
        contract_id: mockGatewayContractId,
        topic: 'print',
        value: {
          hex: `0x${hex.encode(message.buffer)}`,
          repr: '',
        },
      },
    };

    it('Should handle event', async () => {
      gatewayContract.decodeContractCallEvent.mockReturnValueOnce(contractCallEvent);

      const transaction = createMock<Transaction>();
      transaction.tx_id = 'txHash';
      transaction.block_time_iso = '11.05.2024';
      transaction.sender_address = 'sender';

      const result = await service.handleGatewayEvent(rawEvent, transaction, 0, '100', '0');

      expect(gatewayContract.decodeContractCallEvent).toBeCalledTimes(1);

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('CALL');

      const event = result as CallEvent;

      expect(event.eventID).toBe('txHash-0');
      expect(event.message.messageID).toBe('txHash-0');
      expect(event.message.sourceChain).toBe(CONSTANTS.SOURCE_CHAIN_NAME);
      expect(event.message.sourceAddress).toBe(contractCallEvent.sender);
      expect(event.message.destinationAddress).toBe(contractCallEvent.destinationAddress);
      expect(event.message.payloadHash).toBe(BinaryUtils.hexToBase64(contractCallEvent.payloadHash));
      expect(event.destinationChain).toBe(contractCallEvent.destinationChain);
      expect(event.payload).toBe(contractCallEvent.payload.toString('base64'));
      expect(event.meta).toEqual({
        txID: 'txHash',
        fromAddress: transaction.sender_address,
        finalized: true,
        timestamp: '11.05.2024',
      });
    });
  });

  describe('handleMessageApprovedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.MESSAGE_APPROVED_EVENT),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
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
    };

    it('Should handle event', async () => {
      gatewayContract.decodeMessageApprovedEvent.mockReturnValueOnce(messageApprovedEvent);

      const transaction = createMock<Transaction>();
      transaction.tx_id = 'txHash';
      transaction.sender_address = 'senderAddress';
      transaction.block_time_iso = '11.05.2024';

      const result = await service.handleGatewayEvent(rawEvent, transaction, 0, '100', '0');

      expect(gatewayContract.decodeMessageApprovedEvent).toHaveBeenCalledTimes(1);

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('MESSAGE_APPROVED');

      const event = result as MessageApprovedEventApi;

      expect(event.eventID).toBe('txHash-0');
      expect(event.message.messageID).toBe('messageId');
      expect(event.message.sourceChain).toBe('ethereum');
      expect(event.message.sourceAddress).toBe('sourceAddress');
      expect(event.message.destinationAddress).toBe('SP6P4EJF0VG8V0RB3TQQKJBHDQKEF6NVRD1KZE3C');
      expect(event.message.payloadHash).toBe(BinaryUtils.hexToBase64(contractCallEvent.payloadHash));
      expect(event.cost).toEqual({
        amount: '0',
      });
      expect(event.meta).toEqual({
        txID: 'txHash',
        fromAddress: 'senderAddress',
        finalized: true,
        timestamp: '11.05.2024',
      });
    });
  });

  describe('handleMessageExecutedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.MESSAGE_EXECUTED_EVENT),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
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
    };

    const transaction = createMock<Transaction>();
    transaction.tx_id = 'txHash';
    transaction.sender_address = 'senderAddress';
    transaction.block_time_iso = '11.05.2024';

    it('Should handle event update contract call approved', async () => {
      gatewayContract.decodeMessageExecutedEvent.mockReturnValueOnce(messageExecutedEvent);

      const messageApproved: MessageApproved = {
        sourceChain: 'ethereum',
        messageId: 'messageId',
        status: MessageApprovedStatus.PENDING,
        sourceAddress: 'sourceAddress',
        contractAddress: 'senderAddress',
        payloadHash: 'ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
        payload: Buffer.from('payload'),
        retry: 0,
        executeTxHash: null,
        updatedAt: new Date(),
        createdAt: new Date(),
        successTimes: null,
        taskItemId: null,
        availableGasBalance: '0',
        extraData: {},
      };

      messageApprovedRepository.findBySourceChainAndMessageId.mockReturnValueOnce(Promise.resolve(messageApproved));

      const result = await service.handleGatewayEvent(rawEvent, transaction, 0, '100', '0');

      expect(gatewayContract.decodeMessageExecutedEvent).toHaveBeenCalledTimes(1);

      expect(messageApprovedRepository.findBySourceChainAndMessageId).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.findBySourceChainAndMessageId).toHaveBeenCalledWith('ethereum', 'messageId');
      expect(messageApprovedRepository.updateStatusAndSuccessTimes).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.updateStatusAndSuccessTimes).toHaveBeenCalledWith({
        ...messageApproved,
        status: MessageApprovedStatus.SUCCESS,
        successTimes: 1,
      });

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('MESSAGE_EXECUTED');

      const event = result as MessageExecutedEventApi;

      expect(event.eventID).toBe('txHash-0');
      expect(event.messageID).toBe('messageId');
      expect(event.sourceChain).toBe('ethereum');
      expect(event.cost).toEqual({
        amount: '100',
      });
      expect(event.meta).toEqual({
        txID: 'txHash',
        fromAddress: 'senderAddress',
        finalized: true,
        timestamp: '11.05.2024',
      });
    });

    it('Should handle event no contract call approved', async () => {
      messageApprovedRepository.findBySourceChainAndMessageId.mockReturnValueOnce(Promise.resolve(null));

      const result = await service.handleGatewayEvent(rawEvent, transaction, 0, '100', '20');

      expect(gatewayContract.decodeMessageExecutedEvent).toHaveBeenCalledTimes(1);

      expect(messageApprovedRepository.findBySourceChainAndMessageId).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.findBySourceChainAndMessageId).toHaveBeenCalledWith('ethereum', 'messageId');
      expect(messageApprovedRepository.updateManyPartial).not.toHaveBeenCalled();

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('MESSAGE_EXECUTED');

      const event = result as MessageExecutedEventApi;

      expect(event.eventID).toBe('txHash-0');
      expect(event.messageID).toBe('messageId');
      expect(event.sourceChain).toBe('ethereum');
      expect(event.cost).toEqual({
        amount: '120',
      });
      expect(event.meta).toEqual({
        txID: 'txHash',
        fromAddress: 'senderAddress',
        finalized: true,
        timestamp: '11.05.2024',
      });
    });
  });

  describe('handleSignersRotatedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.SIGNERS_ROTATED_EVENT),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
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
    };

    it('Should handle event', async () => {
      gatewayContract.decodeSignersRotatedEvent.mockReturnValueOnce(weightedSigners);

      const transaction = createMock<Transaction>();
      transaction.tx_id = 'txHash';
      transaction.sender_address = 'sender';
      transaction.block_time_iso = '11.02.2024';

      const result = await service.handleGatewayEvent(rawEvent, transaction, 0, '100', '0');

      expect(gatewayContract.decodeSignersRotatedEvent).toHaveBeenCalledTimes(1);

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('SIGNERS_ROTATED');

      const event = result as SignersRotatedEvent;

      expect(event.eventID).toBe('txHash-0');
      expect(event.messageID).toBe('txHash-0');
      expect(event.meta).not.toBeUndefined();
      expect(event?.meta?.epoch).toBe(1);
      expect(event?.meta?.finalized).toBe(true);
      expect(event?.meta?.fromAddress).toBe('sender');
      expect(event?.meta?.signersHash).toBe('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7');
      expect(event?.meta?.timestamp).toBe('11.02.2024');
      expect(event?.meta?.txID).toBe('txHash');
    });
  });
});
