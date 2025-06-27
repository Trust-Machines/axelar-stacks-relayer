import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { hex } from '@scure/base';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { bufferCV, serializeCV, stringAsciiCV, tupleCV } from '@stacks/transactions';
import { ItsProcessor } from './its.processor';
import { ItsContract } from '@stacks-monorepo/common/contracts/ITS/its.contract';
import {
  InterchainTokenDeploymentStartedEvent,
  InterchainTransferEvent,
} from '@stacks-monorepo/common/contracts/entities/its-events';
import ITSInterchainTokenDeploymentStartedEvent = Components.Schemas.ITSInterchainTokenDeploymentStartedEvent;
import ITSInterchainTransferEvent = Components.Schemas.ITSInterchainTransferEvent;
import { BinaryUtils, ScEvent } from '@stacks-monorepo/common';

const mockItsContractId = 'SP6P4EJF0VG8V0RB3TQQKJBHDQKEF6NVRD1KZE3C.its-contract';

describe('ItsProcessor', () => {
  let itsContract: DeepMocked<ItsContract>;

  let service: ItsProcessor;

  const interchainTokenDeploymentStartedEvent: InterchainTokenDeploymentStartedEvent = {
    destinationChain: 'ethereum',
    tokenId: '0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da',
    name: 'name',
    symbol: 'symbol',
    decimals: 6,
    minter: '0xF12372616f9c986355414BA06b3Ca954c0a7b0dC',
  };
  const interchainTransferEvent: InterchainTransferEvent = {
    tokenId: '0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da',
    sourceAddress: 'SP6P4EJF0VG8V0RB3TQQKJBHDQKEF6NVRD1KZE3C',
    destinationChain: 'ethereum',
    destinationAddress: 'destinationAddress',
    amount: '1000000',
    data: 'ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
  };

  beforeEach(async () => {
    itsContract = createMock();

    const moduleRef = await Test.createTestingModule({
      providers: [ItsProcessor],
    })
      .useMocker((token) => {
        if (token === ItsContract) {
          return itsContract;
        }

        return null;
      })
      .compile();

    itsContract.decodeInterchainTokenDeploymentStartedEvent.mockReturnValue(interchainTokenDeploymentStartedEvent);
    itsContract.decodeInterchainTransferEvent.mockReturnValue(interchainTransferEvent);

    service = moduleRef.get(ItsProcessor);
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
        contract_id: mockItsContractId,
        topic: 'print',
        value: {
          hex: `0x${hex.encode(message.buffer)}`,
          repr: '',
        },
      },
    };

    const result = await service.handleItsEvent(rawEvent, createMock(), 0);

    expect(result).toBeUndefined();
    expect(itsContract.decodeInterchainTokenDeploymentStartedEvent).not.toHaveBeenCalled();
    expect(itsContract.decodeInterchainTransferEvent).not.toHaveBeenCalled();
  });

  describe('handleInterchainTokenDeploymentStartedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.INTERCHAIN_TOKEN_DEPLOYMENT_STARTED),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockItsContractId,
        topic: 'print',
        value: {
          hex: `0x${hex.encode(message.buffer)}`,
          repr: '',
        },
      },
    };

    it('Should handle event', async () => {
      const transaction = createMock<Transaction>();
      transaction.tx_id = 'txHash';
      transaction.block_time_iso = '11.05.2024';
      transaction.sender_address = 'sender';

      const result = await service.handleItsEvent(rawEvent, transaction, 0);

      expect(itsContract.decodeInterchainTokenDeploymentStartedEvent).toBeCalledTimes(1);

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('ITS/INTERCHAIN_TOKEN_DEPLOYMENT_STARTED');

      const event = result as ITSInterchainTokenDeploymentStartedEvent;

      expect(event.eventID).toBe('txHash-0');
      expect(event.messageID).toBe('txHash-3');
      expect(event.destinationChain).toBe(interchainTokenDeploymentStartedEvent.destinationChain);
      expect(event.token).toEqual({
        id: interchainTokenDeploymentStartedEvent.tokenId,
        name: interchainTokenDeploymentStartedEvent.name,
        symbol: interchainTokenDeploymentStartedEvent.symbol,
        decimals: interchainTokenDeploymentStartedEvent.decimals,
      });
      expect(event.meta).toEqual({
        txID: 'txHash',
        fromAddress: transaction.sender_address,
        finalized: true,
        timestamp: '11.05.2024',
      });
    });
  });

  describe('handleInterchainTransferEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV(Events.INTERCHAIN_TRANSFER),
        }),
      ),
    );

    const rawEvent: ScEvent = {
      event_index: 0,
      event_type: 'smart_contract_log',
      tx_id: 'txHash',
      contract_log: {
        contract_id: mockItsContractId,
        topic: 'print',
        value: {
          hex: `0x${hex.encode(message.buffer)}`,
          repr: '',
        },
      },
    };

    it('Should handle event', async () => {
      const transaction = createMock<Transaction>();
      transaction.tx_id = 'txHash';
      transaction.block_time_iso = '11.05.2024';
      transaction.sender_address = 'sender';

      const result = await service.handleItsEvent(rawEvent, transaction, 0);

      expect(itsContract.decodeInterchainTransferEvent).toBeCalledTimes(1);

      expect(result).not.toBeUndefined();
      expect(result?.type).toBe('ITS/INTERCHAIN_TRANSFER');

      const event = result as ITSInterchainTransferEvent;

      expect(event.eventID).toBe('txHash-0');
      expect(event.messageID).toBe('txHash-3');
      expect(event.destinationChain).toBe(interchainTransferEvent.destinationChain);
      expect(event.tokenSpent).toEqual({
        tokenID: interchainTransferEvent.tokenId,
        amount: interchainTransferEvent.amount,
      });
      expect(event.sourceAddress).toBe(interchainTransferEvent.sourceAddress);
      expect(event.destinationAddress).toBe(BinaryUtils.hexToBase64(interchainTransferEvent.destinationAddress));
      expect(event.dataHash).toBe(BinaryUtils.hexToBase64(interchainTransferEvent.data));
      expect(event.meta).toEqual({
        txID: 'txHash',
        fromAddress: transaction.sender_address,
        finalized: true,
        timestamp: '11.05.2024',
      });
    });
  });
});
