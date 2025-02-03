import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { GasServiceContract } from '@stacks-monorepo/common/contracts/gas-service.contract';
import { StacksNetwork } from '@stacks/network';
import {
  bufferCV,
  callReadOnlyFunction,
  cvToString,
  principalCV,
  serializeCV,
  stringAsciiCV,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import { bufferFromHex, stringAscii } from '@stacks/transactions/dist/cl';
import { ItsContract } from '@stacks-monorepo/common/contracts/ITS/its.contract';
import { ApiConfigService, GatewayContract, TransactionsHelper } from '@stacks-monorepo/common';
import { TokenManagerContract } from '@stacks-monorepo/common/contracts/ITS/token-manager.contract';
import { NativeInterchainTokenContract } from '@stacks-monorepo/common/contracts/ITS/native-interchain-token.contract';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { HubMessage } from '@stacks-monorepo/common/contracts/ITS/messages/hub.message';
import {
  DeployInterchainToken,
  HubMessageType,
  InterchainTransfer,
  ReceiveFromHub,
} from '@stacks-monorepo/common/contracts/ITS/messages/hub.message.types';
import { TokenType } from '@stacks-monorepo/common/contracts/ITS/types/token-type';
import { getMockScEvent } from '@stacks-monorepo/common/contracts/gas-service.contract.spec';
import { VerifyOnchainContract } from '@stacks-monorepo/common/contracts/ITS/verify-onchain.contract';

jest.mock('@stacks/transactions', () => {
  const actual = jest.requireActual('@stacks/transactions');
  return {
    ...actual,
    callReadOnlyFunction: jest.fn(),
    cvToString: jest.fn(),
  };
});

const proxyContract = 'mockContractAddress.mockContractName-proxy';

describe('ItsContract', () => {
  let service: ItsContract;

  let mockGatewayContract: DeepMocked<GatewayContract>;
  let mockGasServiceContract: DeepMocked<GasServiceContract>;
  let mockNetwork: DeepMocked<StacksNetwork>;
  let mockApiConfigService: DeepMocked<ApiConfigService>;
  let mockTransactionsHelper: DeepMocked<TransactionsHelper>;
  let mockTokenManagerContract: DeepMocked<TokenManagerContract>;
  let mockNativeInterchainTokenContract: DeepMocked<NativeInterchainTokenContract>;
  let mockVerifyOnchain: DeepMocked<VerifyOnchainContract>;

  beforeEach(async () => {
    mockNetwork = createMock<StacksNetwork>();
    mockApiConfigService = createMock<ApiConfigService>();
    mockTransactionsHelper = createMock<TransactionsHelper>();
    mockTokenManagerContract = createMock<TokenManagerContract>();
    mockNativeInterchainTokenContract = createMock<NativeInterchainTokenContract>();
    mockGatewayContract = createMock<GatewayContract>();
    mockGasServiceContract = createMock<GasServiceContract>();
    mockVerifyOnchain = createMock<VerifyOnchainContract>();

    mockApiConfigService.getContractItsProxy.mockReturnValue(proxyContract);
    mockApiConfigService.getContractItsStorage.mockReturnValue('mockContractAddress.mockContractName-storage');
    mockApiConfigService.getAxelarContractIts.mockReturnValue('axelarContract');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ItsContract,
          useFactory: (apiConfigService: ApiConfigService, network: StacksNetwork) => {
            return new ItsContract(
              apiConfigService.getContractItsProxy(),
              apiConfigService.getContractItsStorage(),
              network,
              mockTokenManagerContract,
              mockNativeInterchainTokenContract,
              mockTransactionsHelper,
              mockGatewayContract,
              mockGasServiceContract,
              apiConfigService.getAxelarContractIts(),
              mockVerifyOnchain,
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

    service = module.get<ItsContract>(ItsContract);

    jest.spyOn(HubMessage, 'abiDecode').mockImplementation(jest.fn());

    mockNativeInterchainTokenContract.getTemplaceContractId.mockReturnValue('mockTemplateContractId');
    mockNativeInterchainTokenContract.getTemplateDeployVerificationParams.mockReturnValue(Promise.resolve(tupleCV({})));

    mockVerifyOnchain.buildNativeInterchainTokenVerificationParams.mockReturnValue(Promise.resolve(tupleCV({})));
  });

  describe('getItsImpl', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return cached implementation if available', async () => {
      const callReadOnlyMock = (callReadOnlyFunction as jest.Mock).mockResolvedValueOnce({
        type: 'string_ascii',
        value: 'itsImpl',
      });

      (cvToString as jest.Mock).mockImplementation((clarityValue) => clarityValue.value);

      const result = await service.getItsImpl();
      expect(result).toEqual('itsImpl');
      expect(callReadOnlyMock).toHaveBeenCalledTimes(1);

      callReadOnlyMock.mockClear();

      const cachedResult = await service.getItsImpl();
      expect(cachedResult).toEqual('itsImpl');
      expect(callReadOnlyMock).toHaveBeenCalledTimes(0);
    });

    it('should throw an error if call fails', async () => {
      (callReadOnlyFunction as jest.Mock).mockRejectedValue(new Error('Failed to fetch'));
      await expect(service.getItsImpl()).rejects.toThrow('Failed to fetch');
    });
  });

  describe('execute', () => {
    it('should return null for an invalid payload', async () => {
      jest.spyOn(HubMessage, 'abiDecode').mockReturnValue(null);
      jest.spyOn(service as any, 'handleInterchainTransfer').mockImplementation(jest.fn());
      jest.spyOn(service as any, 'handleDeployNativeInterchainToken').mockImplementation(jest.fn());

      const result = await service.execute(
        'senderKey',
        'sourceChain',
        'messageId',
        'sourceAddress',
        'destinationAddress',
        'invalidPayload',
        '100',
      );

      expect(result).toBeNull();
      expect(service['handleInterchainTransfer']).not.toHaveBeenCalled();
      expect(service['handleDeployNativeInterchainToken']).not.toHaveBeenCalled();
    });

    it('should return null for invalid source chain or address', async () => {
      const senderKey = 'senderKey';
      const sourceChain = 'sourceChain';
      const messageId = 'messageId';
      const availableGasBalance = '100';
      const receiveFromHub = {
        messageType: HubMessageType.ReceiveFromHub,
        sourceChain: sourceChain,
        payload: { messageType: HubMessageType.InterchainTransfer } as InterchainTransfer,
      };

      jest.spyOn(HubMessage, 'abiDecode').mockReturnValue(receiveFromHub);
      jest.spyOn(service as any, 'handleInterchainTransfer').mockImplementation(jest.fn());
      jest.spyOn(service as any, 'handleDeployNativeInterchainToken').mockImplementation(jest.fn());

      const result = await service.execute(
        senderKey,
        sourceChain,
        messageId,
        'sourceAddress',
        'destinationAddress',
        'payload',
        availableGasBalance,
      );

      expect(result).toBeNull();
      expect(service['handleInterchainTransfer']).not.toHaveBeenCalled();
      expect(service['handleDeployNativeInterchainToken']).not.toHaveBeenCalled();
    });

    it('should call handleInterchainTransfer for HubMessageType.InterchainTransfer', async () => {
      const senderKey = 'senderKey';
      const sourceChain = 'axelar';
      const messageId = 'messageId';
      const availableGasBalance = '100';
      const receiveFromHub = {
        messageType: HubMessageType.ReceiveFromHub,
        sourceChain: sourceChain,
        payload: { messageType: HubMessageType.InterchainTransfer } as InterchainTransfer,
      };

      jest.spyOn(HubMessage, 'abiDecode').mockReturnValue(receiveFromHub);
      jest.spyOn(service as any, 'handleInterchainTransfer').mockImplementation(jest.fn());

      await service.execute(
        senderKey,
        sourceChain,
        messageId,
        'axelarContract',
        'destinationAddress',
        'payload',
        availableGasBalance,
      );

      expect(service.handleInterchainTransfer).toHaveBeenCalledWith(
        senderKey,
        receiveFromHub,
        messageId,
        sourceChain,
        availableGasBalance,
      );
    });

    it('should call handleDeployNativeInterchainToken for HubMessageType.DeployInterchainToken', async () => {
      const senderKey = 'senderKey';
      const sourceChain = 'axelar';
      const messageId = 'messageId';
      const availableGasBalance = '100';
      const sourceAddress = 'axelarContract';
      const receiveFromHub = {
        messageType: HubMessageType.ReceiveFromHub,
        sourceChain: sourceChain,
        payload: { messageType: HubMessageType.DeployInterchainToken } as DeployInterchainToken,
      };

      jest.spyOn(HubMessage, 'abiDecode').mockReturnValue(receiveFromHub);
      jest.spyOn(service as any, 'handleDeployNativeInterchainToken').mockImplementation(jest.fn());

      await service.execute(
        senderKey,
        sourceChain,
        messageId,
        sourceAddress,
        'destinationAddress',
        'payload',
        availableGasBalance,
      );

      expect(service.handleDeployNativeInterchainToken).toHaveBeenCalledWith(
        senderKey,
        receiveFromHub,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
      );
    });

    it('should log an error and return null for an unknown message type', async () => {
      const receiveFromHub = {
        messageType: HubMessageType.ReceiveFromHub,
        sourceChain: 'sourceChain',
        payload: { messageType: 5 } as DeployInterchainToken,
      };
      jest.spyOn(HubMessage, 'abiDecode').mockReturnValue(receiveFromHub);

      const result = await service.execute(
        'senderKey',
        'axelar',
        'messageId',
        'axelarContract',
        'destinationAddress',
        'payload',
        '100',
      );

      expect(result).toBeNull();
    });
  });

  describe('handleInterchainTransfer', () => {
    it('should handle interchain transfer successfully', async () => {
      const senderKey = 'senderKey';
      const messageId = 'messageId';
      const sourceChain = 'sourceChain';
      const availableGasBalance = '100';
      const message = {
        messageType: HubMessageType.ReceiveFromHub,
        sourceChain: sourceChain,
        payload: {
          tokenId: 'tokenId',
          sourceAddress: 'sourceAddress',
          data: '',
        },
      } as ReceiveFromHub;

      const tokenInfo = {
        managerAddress: 'managerAddress',
        tokenType: TokenType.NATIVE_INTERCHAIN_TOKEN,
      };

      const transactionMock = { tx_id: 'transactionId' };

      jest.spyOn(service, 'getTokenInfo' as any).mockResolvedValue(tokenInfo);
      jest.spyOn(service, 'executeReceiveInterchainToken' as any).mockResolvedValue(transactionMock);

      const result = await service.handleInterchainTransfer(
        senderKey,
        message,
        messageId,
        sourceChain,
        availableGasBalance,
      );

      expect(service.getTokenInfo).toHaveBeenCalledWith(message.payload.tokenId);
      expect(service.executeReceiveInterchainToken).toHaveBeenCalledWith(
        senderKey,
        message,
        messageId,
        sourceChain,
        tokenInfo,
        availableGasBalance,
      );
      expect(result).toEqual(transactionMock);
    });

    it('should throw an error if token info cannot be fetched', async () => {
      const senderKey = 'senderKey';
      const messageId = 'messageId';
      const sourceChain = 'sourceChain';
      const availableGasBalance = '100';
      const message = {
        messageType: HubMessageType.ReceiveFromHub,
        sourceChain: sourceChain,
        payload: {
          tokenId: 'tokenId',
          sourceAddress: 'sourceAddress',
          data: '',
        },
      } as ReceiveFromHub;

      jest.spyOn(service, 'getTokenInfo' as any).mockResolvedValue(null);
      jest.spyOn(service as any, 'executeReceiveInterchainToken').mockResolvedValue(undefined);

      await expect(
        service.handleInterchainTransfer(senderKey, message, messageId, sourceChain, availableGasBalance),
      ).rejects.toThrow('Could not get token info');
      expect(service['getTokenInfo']).toHaveBeenCalledWith(message.payload.tokenId);
      expect(service['executeReceiveInterchainToken']).not.toHaveBeenCalled();
    });
  });

  describe('handleDeployNativeInterchainToken', () => {
    it('should successfully handle native interchain token deployment', async () => {
      const senderKey = 'senderKey';
      const message = {
        messageType: HubMessageType.ReceiveFromHub,
        payload: { name: 'tokenName', messageType: HubMessageType.DeployInterchainToken } as DeployInterchainToken,
      } as ReceiveFromHub;
      const messageId = 'messageId';
      const sourceChain = 'axelar';
      const sourceAddress = 'axelarContract';
      const availableGasBalance = '100';
      const deployTx = {
        success: true,
        transaction: {
          tx_id: 'deployTxId',
          tx_type: 'smart_contract',
          smart_contract: { contract_id: 'mockContractAddress.mockContractName' },
        },
      };
      const setupTx = { tx_id: 'setupTxId' };
      const executeTx = { tx_id: 'executeTxId' };
      jest.spyOn(mockNativeInterchainTokenContract as any, 'deployContractTransaction').mockResolvedValue(deployTx);
      jest
        .spyOn(mockNativeInterchainTokenContract as any, 'doSetupContract')
        .mockResolvedValue({ success: true, transaction: setupTx });
      jest.spyOn(service as any, 'executeDeployInterchainToken').mockResolvedValue(executeTx);
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));
      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
      );

      expect(mockNativeInterchainTokenContract.getTemplaceContractId).toHaveBeenCalledTimes(1);
      expect(mockNativeInterchainTokenContract.getTemplateDeployVerificationParams).toHaveBeenCalledTimes(1);
      expect(mockVerifyOnchain.buildNativeInterchainTokenVerificationParams).toHaveBeenCalledTimes(1);

      expect(mockNativeInterchainTokenContract.deployContractTransaction).toHaveBeenCalledWith(
        senderKey,
        (message.payload as DeployInterchainToken).name,
      );
      expect(mockNativeInterchainTokenContract.doSetupContract).toHaveBeenCalledWith(
        senderKey,
        'mockContractAddress',
        'mockContractName',
        message,
      );
      expect(service.executeDeployInterchainToken).toHaveBeenCalledWith(
        senderKey,
        expect.anything(),
        messageId,
        sourceChain,
        sourceAddress,
        'mockTemplateContractId',
        expect.anything(),
      );
      expect(service.executeDeployInterchainToken).toHaveBeenCalledWith(
        senderKey,
        expect.anything(),
        messageId,
        sourceChain,
        sourceAddress,
        'mockContractAddress.mockContractName',
        expect.anything(),
      );
      expect(result).toEqual(executeTx);
    });

    it('should fail if deployment fails', async () => {
      const senderKey = 'senderKey';
      const message = { payload: { name: 'testToken' } } as ReceiveFromHub;
      const messageId = 'messageId';
      const sourceChain = 'sourceChain';
      const sourceAddress = 'sourceAddress';
      const availableGasBalance = '100';
      jest
        .spyOn(mockNativeInterchainTokenContract, 'deployContractTransaction')
        .mockResolvedValue({ success: false, transaction: null });
      jest.spyOn(mockNativeInterchainTokenContract, 'doSetupContract').mockImplementation(jest.fn());
      jest.spyOn(service, 'executeDeployInterchainToken').mockImplementation(jest.fn());
      mockTransactionsHelper.checkAvailableGasBalance.mockResolvedValue(true);
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));
      await expect(
        service.handleDeployNativeInterchainToken(
          senderKey,
          message,
          messageId,
          sourceChain,
          sourceAddress,
          availableGasBalance,
        ),
      ).rejects.toThrow('Could not deploy native interchain token, hash = undefined');
    });
    it('should fail if setup transaction fails', async () => {
      const senderKey = 'senderKey';
      const message = { payload: { name: 'testToken' } } as ReceiveFromHub;
      const messageId = 'messageId';
      const sourceChain = 'sourceChain';
      const sourceAddress = 'sourceAddress';
      const availableGasBalance = '100';
      jest.spyOn(mockNativeInterchainTokenContract, 'deployContractTransaction').mockResolvedValue({
        success: true,
        transaction: {
          tx_id: 'mockDeployTxId',
          tx_type: 'smart_contract',
          smart_contract: { contract_id: 'mockContractAddress.mockContractName' } as any,
        } as any,
      });
      jest
        .spyOn(mockNativeInterchainTokenContract, 'doSetupContract')
        .mockResolvedValue({ success: false, transaction: null });
      jest.spyOn(service, 'executeDeployInterchainToken').mockImplementation(jest.fn());
      mockTransactionsHelper.checkAvailableGasBalance.mockResolvedValue(true);
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));
      await expect(
        service.handleDeployNativeInterchainToken(
          senderKey,
          message,
          messageId,
          sourceChain,
          sourceAddress,
          availableGasBalance,
        ),
      ).rejects.toThrow('Could not setup native interchain token, hash = undefined');
    });

    it('should fail if available gas balance check fails', async () => {
      const senderKey = 'senderKey';
      const message = { payload: { name: 'testToken' } } as ReceiveFromHub;
      const messageId = 'messageId';
      const sourceChain = 'sourceChain';
      const sourceAddress = 'sourceAddress';
      const availableGasBalance = '100';
      jest.spyOn(mockNativeInterchainTokenContract, 'deployContractTransaction').mockImplementation(jest.fn());
      jest.spyOn(mockNativeInterchainTokenContract, 'doSetupContract').mockImplementation(jest.fn());
      jest.spyOn(service, 'executeDeployInterchainToken').mockImplementation(jest.fn());
      mockTransactionsHelper.checkAvailableGasBalance.mockRejectedValue(new Error('Insufficient gas balance'));
      await expect(
        service.handleDeployNativeInterchainToken(
          senderKey,
          message,
          messageId,
          sourceChain,
          sourceAddress,
          availableGasBalance,
        ),
      ).rejects.toThrow('Insufficient gas balance');
    });
  });

  describe('decodeInterchainTokenDeploymentStartedEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV('interchain-token-deployment-started'),
          'destination-chain': stringAsciiCV('ethereum'),
          'token-id': bufferFromHex('11228e4ef3805b921c2a5062537ebcb8bff5635c72f5ec6950c8c37c0cad8669'),
          name: stringAsciiCV('name'),
          symbol: stringAsciiCV('symbol'),
          decimals: uintCV(6),
          minter: bufferFromHex('F12372616f9c986355414BA06b3Ca954c0a7b0dC'),
        }),
      ),
    );

    const mockScEvent = getMockScEvent(message);

    it('Should decode event', () => {
      const result = service.decodeInterchainTokenDeploymentStartedEvent(mockScEvent);

      expect(result.destinationChain).toBe('ethereum');
      expect(result.tokenId).toBe('0x11228e4ef3805b921c2a5062537ebcb8bff5635c72f5ec6950c8c37c0cad8669');
      expect(result.name).toBe('name');
      expect(result.symbol).toBe('symbol');
      expect(result.decimals).toBe(6);
      expect(result.minter).toBe('0xf12372616f9c986355414ba06b3ca954c0a7b0dc');
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => service.decodeInterchainTokenDeploymentStartedEvent(mockScEvent)).toThrow();
    });
  });

  describe('decodeInterchainTransferEvent', () => {
    const message = bufferCV(
      serializeCV(
        tupleCV({
          type: stringAsciiCV('interchain-transfer'),
          'token-id': bufferFromHex('11228e4ef3805b921c2a5062537ebcb8bff5635c72f5ec6950c8c37c0cad8669'),
          'source-address': principalCV('SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV'),
          'destination-chain': stringAsciiCV('ethereum'),
          'destination-address': bufferFromHex('ebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7'),
          amount: uintCV(1000000),
          data: bufferFromHex('F12372616f9c986355414BA06b3Ca954c0a7b0dC'),
        }),
      ),
    );

    const mockScEvent = getMockScEvent(message);

    it('Should decode event', () => {
      const result = service.decodeInterchainTransferEvent(mockScEvent);

      expect(result.tokenId).toBe('0x11228e4ef3805b921c2a5062537ebcb8bff5635c72f5ec6950c8c37c0cad8669');
      expect(result.sourceAddress).toBe('SP31SWB58Q599WE8YP6BEJP3XD3QMBJJ7534HSCZV');
      expect(result.destinationChain).toBe('ethereum');
      expect(result.destinationAddress).toBe('0xebc84cbd75ba5516bf45e7024a9e12bc3c5c880f73e3a5beca7ebba52b2867a7');
      expect(result.amount).toBe('1000000');
      expect(result.data).toBe('0xf12372616f9c986355414ba06b3ca954c0a7b0dc');
    });

    it('Should throw error while decoding', () => {
      mockScEvent.contract_log.value.hex = '';

      expect(() => service.decodeInterchainTransferEvent(mockScEvent)).toThrow();
    });
  });
});
