import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { GasServiceContract } from '@stacks-monorepo/common/contracts/gas-service.contract';

import { hex } from '@scure/base';
import { StacksNetwork } from '@stacks/network';
import {
  BufferCV,
  bufferCV,
  stringAsciiCV,
  principalCV,
  serializeCV,
  tupleCV,
  uintCV,
  cvToString,
  callReadOnlyFunction,
} from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import BigNumber from 'bignumber.js';
import { ApiConfigService } from '../config';
import { ProviderKeys } from '../utils/provider.enum';
import { TransactionsHelper } from './transactions.helper';
import { ScEvent } from '@stacks-monorepo/common';

export function getMockScEvent(message: BufferCV): ScEvent {
  return {
    tx_id: '1',
    event_index: 0,
    event_type: 'smart_contract_log',
    contract_log: {
      contract_id: '',
      topic: 'print',
      value: {
        hex: `0x${hex.encode(message.buffer)}`,
        repr: '',
      },
    },
  };
}

jest.mock('@stacks/transactions', () => {
  const actual = jest.requireActual('@stacks/transactions');
  return {
    ...actual,
    callReadOnlyFunction: jest.fn(),
    cvToString: jest.fn(),
  };
});

describe('GasServiceContract', () => {
  let contract: GasServiceContract;
  let mockNetwork: DeepMocked<StacksNetwork>;
  let mockApiConfigService: DeepMocked<ApiConfigService>;
  let mockTransactionsHelper: DeepMocked<TransactionsHelper>;

  beforeEach(async () => {
    mockNetwork = createMock<StacksNetwork>();
    mockApiConfigService = createMock<ApiConfigService>();
    mockTransactionsHelper = createMock<TransactionsHelper>();

    mockApiConfigService.getContractGasServiceProxy.mockReturnValue('mockContractAddress.mockContractName-proxy');
    mockApiConfigService.getContractGasServiceStorage.mockReturnValue('mockContractAddress.mockContractName-storage');

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: GasServiceContract,
          useFactory: (apiConfigService: ApiConfigService, network: StacksNetwork) => {
            return new GasServiceContract(
              apiConfigService.getContractGasServiceProxy(),
              apiConfigService.getContractGasServiceStorage(),
              network,
              mockTransactionsHelper,
            );
          },
          inject: [ApiConfigService, ProviderKeys.STACKS_NETWORK],
        },
        {
          provide: ApiConfigService,
          useValue: mockApiConfigService,
        },
        {
          provide: ProviderKeys.STACKS_NETWORK,
          useValue: mockNetwork,
        },
      ],
    }).compile();

    contract = moduleRef.get(GasServiceContract);
  });

  describe('getGasImpl', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return cached implementation if available', async () => {
      const callReadOnlyMock = (callReadOnlyFunction as jest.Mock).mockResolvedValueOnce({
        type: 'string_ascii',
        value: 'gasImpl',
      });

      (cvToString as jest.Mock).mockImplementation((clarityValue) => clarityValue.value);

      const result = await contract.getGasImpl();
      expect(result).toEqual('gasImpl');
      expect(callReadOnlyMock).toHaveBeenCalledTimes(1);

      callReadOnlyMock.mockClear();

      const cachedResult = await contract.getGasImpl();
      expect(cachedResult).toEqual('gasImpl');
      expect(callReadOnlyMock).toHaveBeenCalledTimes(0);
    });

    it('should throw an error if call fails', async () => {
      (callReadOnlyFunction as jest.Mock).mockRejectedValue(new Error('Failed to fetch'));
      await expect(contract.getGasImpl()).rejects.toThrow('Failed to fetch');
    });
  });

  describe('decodeNativeGasPaidForContractCallEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          sender: principalCV('SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV'),
          amount: uintCV(1000),
          'refund-address': principalCV('SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV'),
          'destination-chain': stringAsciiCV('ethereum'),
          'destination-address': stringAsciiCV('destinationAddress'),
          'payload-hash': bufferFromHex('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7'),
          type: stringAsciiCV('native-gas-paid-for-contract-call'),
        }),
      ),
    );

    const mockScEvent = getMockScEvent(message);

    it('Should decode event', () => {
      const result = contract.decodeNativeGasPaidForContractCallEvent(mockScEvent);

      expect(result).toEqual({
        sender: 'SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV',
        destinationChain: 'ethereum',
        destinationAddress: 'destinationAddress',
        payloadHash: '0xebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
        amount: new BigNumber('1000'),
        refundAddress: 'SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV',
      });
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => contract.decodeNativeGasPaidForContractCallEvent(mockScEvent)).toThrow();
    });
  });

  describe('decodeNativeGasAddedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          amount: uintCV(1000),
          'refund-address': principalCV('SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV'),
          'tx-hash': bufferFromHex('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7'),
          'log-index': uintCV(1),
          type: stringAsciiCV('native-gas-added'),
        }),
      ),
    );

    const mockScEvent = getMockScEvent(message);

    it('Should decode event', () => {
      const result = contract.decodeNativeGasAddedEvent(mockScEvent);

      expect(result).toEqual({
        txHash: '0xebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
        logIndex: 1,
        amount: new BigNumber('1000'),
        refundAddress: 'SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV',
      });
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => contract.decodeNativeGasAddedEvent(mockScEvent)).toThrow();
    });
  });

  describe('decodeRefundedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          receiver: principalCV('SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV'),
          amount: uintCV(1000),
          'tx-hash': bufferFromHex('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7'),
          'log-index': uintCV(1),
          type: stringAsciiCV('refunded'),
        }),
      ),
    );

    const mockScEvent = getMockScEvent(message);

    it('Should decode event', () => {
      const result = contract.decodeRefundedEvent(mockScEvent);

      expect(result).toEqual({
        txHash: '0xebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
        logIndex: 1,
        receiver: 'SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV',
        amount: new BigNumber('1000'),
      });
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => contract.decodeRefundedEvent(mockScEvent)).toThrow();
    });
  });
});
