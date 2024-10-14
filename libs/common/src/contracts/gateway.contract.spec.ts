import { Test } from '@nestjs/testing';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { StacksNetwork } from '@stacks/network';
import { DeepMocked, createMock } from '@golevelup/ts-jest';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import { ApiConfigService } from '../config';
import { ProviderKeys } from '../utils/provider.enum';
import { bufferCV, serializeCV, tupleCV, bufferCVFromString, principalCV, listCV, uintCV } from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { hex } from '@scure/base';
import BigNumber from 'bignumber.js';

describe('GatewayContract', () => {
  let contract: GatewayContract;
  let mockNetwork: DeepMocked<StacksNetwork>;
  let mockApiConfigService: DeepMocked<ApiConfigService>;

  beforeEach(async () => {
    mockNetwork = createMock<StacksNetwork>();
    mockApiConfigService = createMock<ApiConfigService>();

    mockApiConfigService.getContractGateway.mockReturnValue('mockContractAddress');
    mockApiConfigService.getGatewayContractName.mockReturnValue('mockContractName');

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: GatewayContract,
          useFactory: async (apiConfigService: ApiConfigService, network: StacksNetwork) => {
            return new GatewayContract(
              apiConfigService.getContractGateway(),
              apiConfigService.getGatewayContractName(),
              network,
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
          'destination-chain': bufferCVFromString('ethereum'),
          'destination-contract-address': bufferCVFromString('destinationAddress'),
          'payload-hash': bufferFromHex('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7'),
          payload: bufferCV(Buffer.from('payload')),
          type: bufferCVFromString('contract-call'),
        }),
      ),
    );

    const mockScEvent: ScEvent = {
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
          'source-chain': bufferCVFromString('ethereum'),
          'message-id': bufferFromHex('fe0d2393e76ea487217b1606aff64535f8526a00e007704f8391fa41c78fb451'),
          'source-address': bufferFromHex('000E91D671C29c2DBBc81D16adA4a8bDd6fE518F'),
          'contract-address': bufferFromHex('000F9B4FF55aFcC3C4f9f325EE890c0C806E8FCC'),
          'payload-hash': bufferFromHex('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7'),
          type: bufferCVFromString('contract-call'),
        }),
      ),
    );

    const mockScEvent: ScEvent = {
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

    it('Should decode event', () => {
      const result = contract.decodeMessageApprovedEvent(mockScEvent);

      expect(result).toEqual({
        commandId: '0x0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da',
        sourceChain: 'ethereum',
        sourceAddress: '0x000E91D671C29c2DBBc81D16adA4a8bDd6fE518F'.toLowerCase(),
        messageId: '0xfe0d2393e76ea487217b1606aff64535f8526a00e007704f8391fa41c78fb451',
        contractAddress: '0x000F9B4FF55aFcC3C4f9f325EE890c0C806E8FCC'.toLowerCase(),
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
          type: bufferCVFromString('signers-rotated'),
        }),
      ),
    );

    const mockScEvent: ScEvent = {
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
          'source-chain': bufferCVFromString('ethereum'),
          'message-id': bufferFromHex('fe0d2393e76ea487217b1606aff64535f8526a00e007704f8391fa41c78fb451'),
          type: bufferCVFromString('message-executed'),
        }),
      ),
    );

    const mockScEvent: ScEvent = {
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

    it('Should decode event', () => {
      const result = contract.decodeMessageExecutedEvent(mockScEvent);

      expect(result).toEqual({
        commandId: '0x0c38359b7a35c755573659d797afec315bb0e51374a056745abd9764715a15da',
        sourceChain: 'ethereum',
        messageId: '0xfe0d2393e76ea487217b1606aff64535f8526a00e007704f8391fa41c78fb451',
      });
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => contract.decodeMessageExecutedEvent(mockScEvent)).toThrow();
    });
  });
});
