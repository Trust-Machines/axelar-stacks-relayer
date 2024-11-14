import { DeepMocked, createMock } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { StacksNetwork } from '@stacks/network';
import { bufferCV, listCV, principalCV, serializeCV, stringAsciiCV, tupleCV, uintCV } from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import BigNumber from 'bignumber.js';
import { ApiConfigService } from '../config';
import { ProviderKeys } from '../utils/provider.enum';
import { getMockScEvent } from './gas-service.contract.spec';
import { TransactionsHelper } from './transactions.helper';

describe('GatewayContract', () => {
  let contract: GatewayContract;
  let mockNetwork: DeepMocked<StacksNetwork>;
  let mockApiConfigService: DeepMocked<ApiConfigService>;
  let mockTransactionsHelper: DeepMocked<TransactionsHelper>;

  beforeEach(async () => {
    mockNetwork = createMock<StacksNetwork>();
    mockApiConfigService = createMock<ApiConfigService>();
    mockTransactionsHelper = createMock<TransactionsHelper>();

    mockApiConfigService.getContractGatewayStorage.mockReturnValue('mockContractAddress.mockStorageContractName');
    mockApiConfigService.getContractGatewayProxy.mockReturnValue('mockContractAddress.mockProxyContractName');

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: GatewayContract,
          useFactory: (apiConfigService: ApiConfigService, network: StacksNetwork) => {
            return new GatewayContract(
              apiConfigService.getContractGatewayStorage(),
              apiConfigService.getContractGatewayProxy(),
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

    contract = moduleRef.get<GatewayContract>(GatewayContract);
  });

  describe('decodeContractCallEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          sender: principalCV('SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV'),
          'destination-chain': stringAsciiCV('ethereum'),
          'destination-contract-address': stringAsciiCV('destinationAddress'),
          'payload-hash': bufferFromHex('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7'),
          payload: bufferCV(Buffer.from('payload')),
          type: stringAsciiCV('contract-call'),
        }),
      ),
    );

    const mockScEvent = getMockScEvent(message);

    it('Should decode event', () => {
      const result = contract.decodeContractCallEvent(mockScEvent);

      expect(result).toEqual({
        sender: 'SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV',
        destinationChain: 'ethereum',
        destinationAddress: 'destinationAddress',
        payloadHash: '0xebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
        payload: Buffer.from('payload'),
      });
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => contract.decodeContractCallEvent(mockScEvent)).toThrow();
    });
  });

  describe('decodeMessageApprovedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          'command-id': bufferFromHex('0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da'),
          'source-chain': stringAsciiCV('ethereum'),
          'message-id': stringAsciiCV('fe0d2393e76ea487217b1606aff64535f8526a00e007704f8391fa41c78fb451'),
          'source-address': stringAsciiCV('000E91D671C29c2DBBc81D16adA4a8bDd6fE518F'),
          'contract-address': principalCV('SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV'),
          'payload-hash': bufferFromHex('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7'),
          type: stringAsciiCV('contract-call'),
        }),
      ),
    );

    const mockScEvent = getMockScEvent(message);

    it('Should decode event', () => {
      const result = contract.decodeMessageApprovedEvent(mockScEvent);

      expect(result).toEqual({
        commandId: '0x0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da',
        sourceChain: 'ethereum',
        sourceAddress: '000E91D671C29c2DBBc81D16adA4a8bDd6fE518F',
        messageId: 'fe0d2393e76ea487217b1606aff64535f8526a00e007704f8391fa41c78fb451',
        contractAddress: 'SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV',
        payloadHash: '0xebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7',
      });
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => contract.decodeMessageApprovedEvent(mockScEvent)).toThrow();
    });
  });

  describe('decodeSignersRotatedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          signers: tupleCV({
            signers: listCV([
              tupleCV({
                signer: principalCV('SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV'),
                weight: uintCV(1),
              }),
              tupleCV({
                signer: principalCV('SP1H6WMP29RXTQQCB3QSA146P6SR7G59BVHTTKWCC'),
                weight: uintCV(2),
              }),
              tupleCV({
                signer: principalCV('SP1N6CA5FQPE8PH1MK074YA8XQJZYPS8D56GKS9W6'),
                weight: uintCV(2),
              }),
            ]),
            threshold: uintCV(3),
            nonce: bufferFromHex('11228e4ef3805b921c2a5062537ebcb8bff5635c72f5ec6950c8c37c0cad8669'),
          }),
          type: stringAsciiCV('signers-rotated'),
          epoch: uintCV(1),
          'signers-hash': bufferFromHex('11228e4ef3805b921c2a5062537ebcb8bff5635c72f5ec6950c8c37c0cad8669'),
        }),
      ),
    );

    const mockScEvent = getMockScEvent(message);

    it('Should decode event', () => {
      const result = contract.decodeSignersRotatedEvent(mockScEvent);

      expect(result.signers).toEqual([
        { signer: 'SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV', weight: new BigNumber('1') },
        { signer: 'SP1H6WMP29RXTQQCB3QSA146P6SR7G59BVHTTKWCC', weight: new BigNumber('2') },
        { signer: 'SP1N6CA5FQPE8PH1MK074YA8XQJZYPS8D56GKS9W6', weight: new BigNumber('2') },
      ]);
      expect(result.threshold).toEqual(new BigNumber('3'));
      expect(result.nonce).toEqual('0x11228e4ef3805b921c2a5062537ebcb8bff5635c72f5ec6950c8c37c0cad8669');
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => contract.decodeSignersRotatedEvent(mockScEvent)).toThrow();
    });
  });

  describe('decodeMessageExecutedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          'command-id': bufferFromHex('0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da'),
          'source-chain': stringAsciiCV('ethereum'),
          'message-id': stringAsciiCV('fe0d2393e76ea487217b1606aff64535f8526a00e007704f8391fa41c78fb451'),
          type: stringAsciiCV('message-executed'),
        }),
      ),
    );

    const mockScEvent = getMockScEvent(message);

    it('Should decode event', () => {
      const result = contract.decodeMessageExecutedEvent(mockScEvent);

      expect(result).toEqual({
        commandId: '0x0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da',
        sourceChain: 'ethereum',
        messageId: 'fe0d2393e76ea487217b1606aff64535f8526a00e007704f8391fa41c78fb451',
      });
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => contract.decodeMessageExecutedEvent(mockScEvent)).toThrow();
    });
  });
});
