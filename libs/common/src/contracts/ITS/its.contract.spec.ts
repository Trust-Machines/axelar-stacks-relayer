import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiConfigService } from '@stacks-monorepo/common/config';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import {
  DecodingUtils,
  tokenManagerParamsDecoder,
  verifyInterchainTokenDecoder,
  verifyTokenManagerDecoder,
} from '@stacks-monorepo/common/utils/decoding.utils';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksNetwork } from '@stacks/network';
import { callReadOnlyFunction, cvToString } from '@stacks/transactions';
import { stringAscii } from '@stacks/transactions/dist/cl';
import { GasServiceContract } from '../gas-service.contract';
import { GatewayContract } from '../gateway.contract';
import { TransactionsHelper } from '../transactions.helper';
import { ItsContract } from './its.contract';
import { HubMessage } from './messages/hub.message';
import {
  DeployInterchainToken,
  DeployTokenManager,
  HubMessageType,
  InterchainTransfer,
  ReceiveFromHub,
  VerifyMessageType,
} from './messages/hub.message.types';
import { NativeInterchainTokenContract } from './native-interchain-token.contract';
import { TokenManagerContract } from './token-manager.contract';
import { TokenType } from './types/token-type';

jest.mock('@stacks/transactions', () => ({
  callReadOnlyFunction: jest.fn(),
  cvToString: jest.fn(),
  optionalCVOf: jest.fn(),
  principalCV: jest.fn(),
  stringAsciiCV: jest.fn(),
  deserializeCV: jest.fn(),
  cvToJSON: jest.fn(),
  bufferCV: jest.fn(),
  AnchorMode: { Any: 'mockedAnchorMode' },
}));

jest.mock('@stacks-monorepo/common/utils/decoding.utils');

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

  beforeEach(async () => {
    mockNetwork = createMock<StacksNetwork>();
    mockApiConfigService = createMock<ApiConfigService>();
    mockTransactionsHelper = createMock<TransactionsHelper>();
    mockTokenManagerContract = createMock<TokenManagerContract>();
    mockNativeInterchainTokenContract = createMock<NativeInterchainTokenContract>();
    mockGatewayContract = createMock<GatewayContract>();
    mockGasServiceContract = createMock<GasServiceContract>();

    mockApiConfigService.getContractItsProxy.mockReturnValue(proxyContract);
    mockApiConfigService.getContractItsStorage.mockReturnValue('mockContractAddress.mockContractName-storage');

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
    it('should call handleVerifyCall when source and destination addresses match', async () => {
      const senderKey = 'senderKey';
      const sourceChain = CONSTANTS.SOURCE_CHAIN_NAME;
      const sourceAddress = proxyContract;
      const destinationAddress = proxyContract;
      const messageId = 'messageId';
      const payload = 'payload';
      const availableGasBalance = '100';

      jest.spyOn(service as any, 'handleVerifyCall').mockImplementation(jest.fn());

      await service.execute(
        senderKey,
        sourceChain,
        messageId,
        sourceAddress,
        destinationAddress,
        payload,
        availableGasBalance,
      );

      expect(service.handleVerifyCall).toHaveBeenCalledWith(
        senderKey,
        payload,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
      );
    });

    it('should return null for an invalid payload', async () => {
      jest.spyOn(HubMessage, 'abiDecode').mockReturnValue(null);
      jest.spyOn(service as any, 'handleVerifyCall').mockImplementation(jest.fn());
      jest.spyOn(service as any, 'handleInterchainTransfer').mockImplementation(jest.fn());
      jest.spyOn(service as any, 'handleDeployNativeInterchainToken').mockImplementation(jest.fn());
      jest.spyOn(service as any, 'handleDeployTokenManager').mockImplementation(jest.fn());

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
      expect(service['handleVerifyCall']).not.toHaveBeenCalled();
      expect(service['handleInterchainTransfer']).not.toHaveBeenCalled();
      expect(service['handleDeployNativeInterchainToken']).not.toHaveBeenCalled();
      expect(service['handleDeployTokenManager']).not.toHaveBeenCalled();
    });

    it('should call handleInterchainTransfer for HubMessageType.InterchainTransfer', async () => {
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

      await service.execute(
        senderKey,
        sourceChain,
        messageId,
        'sourceAddress',
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
      const sourceChain = 'sourceChain';
      const messageId = 'messageId';
      const availableGasBalance = '100';
      const sourceAddress = 'sourceAddress';
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

    it('should call handleDeployTokenManager for HubMessageType.DeployTokenManager', async () => {
      const senderKey = 'senderKey';
      const sourceChain = 'sourceChain';
      const messageId = 'messageId';
      const availableGasBalance = '100';
      const sourceAddress = 'sourceAddress';
      const receiveFromHub = {
        messageType: HubMessageType.ReceiveFromHub,
        sourceChain: sourceChain,
        payload: { messageType: HubMessageType.DeployTokenManager } as DeployTokenManager,
      };

      jest.spyOn(HubMessage, 'abiDecode').mockReturnValue(receiveFromHub);
      jest.spyOn(service as any, 'handleDeployTokenManager').mockImplementation(jest.fn());

      await service.execute(
        senderKey,
        sourceChain,
        messageId,
        sourceAddress,
        'destinationAddress',
        'payload',
        availableGasBalance,
      );

      expect(service['handleDeployTokenManager']).toHaveBeenCalledWith(
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
        payload: { messageType: 5 } as DeployTokenManager,
      };
      jest.spyOn(HubMessage, 'abiDecode').mockReturnValue(receiveFromHub);

      const result = await service.execute(
        'senderKey',
        'sourceChain',
        'messageId',
        'sourceAddress',
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
      const sourceChain = 'sourceChain';
      const sourceAddress = 'sourceAddress';
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
      jest.spyOn(service as any, 'deployNativeInterchainTokenContract').mockResolvedValue(deployTx);
      jest
        .spyOn(service as any, 'setupNativeInterchainTokenContract')
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
      expect(service.deployNativeInterchainTokenContract).toHaveBeenCalledWith(
        senderKey,
        (message.payload as DeployInterchainToken).name,
      );
      expect(service.setupNativeInterchainTokenContract).toHaveBeenCalledWith(
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
        'mockContractId',
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
        .spyOn(service, 'deployNativeInterchainTokenContract')
        .mockResolvedValue({ success: false, transaction: null });
      jest.spyOn(service, 'setupNativeInterchainTokenContract').mockImplementation(jest.fn());
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
      jest.spyOn(service, 'deployNativeInterchainTokenContract').mockResolvedValue({
        success: true,
        transaction: {
          tx_id: 'mockDeployTxId',
          tx_type: 'smart_contract',
          smart_contract: { contract_id: 'mockContractAddress.mockContractName' } as any,
        } as any,
      });
      jest
        .spyOn(service, 'setupNativeInterchainTokenContract')
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
      jest.spyOn(service, 'deployNativeInterchainTokenContract').mockImplementation(jest.fn());
      jest.spyOn(service, 'setupNativeInterchainTokenContract').mockImplementation(jest.fn());
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

  describe('handleDeployTokenManager', () => {
    it('should successfully handle token manager deployment', async () => {
      const senderKey = 'senderKey';
      const message = {
        messageType: HubMessageType.ReceiveFromHub,
        payload: { tokenId: 'tokenId', messageType: HubMessageType.DeployTokenManager } as DeployTokenManager,
      } as ReceiveFromHub;
      const messageId = 'messageId';
      const sourceChain = 'sourceChain';
      const sourceAddress = 'sourceAddress';
      const availableGasBalance = '100';
      const deployTx = {
        success: true,
        transaction: {
          tx_id: 'deployTxId',
          tx_type: 'smart_contract',
          smart_contract: { contract_id: 'mockContractAddress.mockContractName' },
        } as any,
      };
      const setupTx = { tx_id: 'setupTxId' } as any;
      const executeTx = { tx_id: 'executeTxId' } as any;
      jest.spyOn(service, 'deployTokenManagerContract').mockResolvedValue(deployTx);
      jest.spyOn(service, 'setupTokenManagerContract').mockResolvedValue({ success: true, transaction: setupTx });
      jest.spyOn(service, 'executeDeployTokenManager').mockResolvedValue(executeTx);
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));
      (tokenManagerParamsDecoder as jest.Mock).mockReturnValue({
        operator: 'mockOperator',
        tokenAddress: 'mockTokenAddress',
      });
      const result = await service.handleDeployTokenManager(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
      );
      expect(service.deployTokenManagerContract).toHaveBeenCalledWith(
        senderKey,
        (message.payload as DeployTokenManager).tokenId,
      );
      expect(service.setupTokenManagerContract).toHaveBeenCalledWith(
        senderKey,
        'mockContractAddress',
        'mockContractName',
        message.payload,
        expect.anything(),
      );
      expect(service.executeDeployTokenManager).toHaveBeenCalledWith(
        senderKey,
        expect.anything(),
        messageId,
        sourceChain,
        sourceAddress,
        'mockContractId',
        expect.anything(),
        expect.anything(),
      );
      expect(result).toEqual(executeTx);
    });

    it('should fail if deployment fails', async () => {
      const senderKey = 'senderKey';
      const message = { payload: { tokenId: 'testToken' } } as ReceiveFromHub;
      const messageId = 'messageId';
      const sourceChain = 'sourceChain';
      const sourceAddress = 'sourceAddress';
      const availableGasBalance = '100';
      jest.spyOn(service, 'deployTokenManagerContract').mockResolvedValue({
        success: false,
        transaction: null,
      });
      jest.spyOn(service, 'setupTokenManagerContract').mockImplementation(jest.fn());
      jest.spyOn(service, 'executeDeployTokenManager').mockImplementation(jest.fn());
      mockTransactionsHelper.checkAvailableGasBalance.mockResolvedValue(true);
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));
      (tokenManagerParamsDecoder as jest.Mock).mockReturnValue({
        operator: 'mockOperator',
        tokenAddress: 'mockTokenAddress',
      });
      await expect(
        service.handleDeployTokenManager(
          senderKey,
          message,
          messageId,
          sourceChain,
          sourceAddress,
          availableGasBalance,
        ),
      ).rejects.toThrow('Could not deploy token manager contract, hash = undefined');
    });

    it('should fail if setup transaction fails', async () => {
      const senderKey = 'senderKey';
      const message = { payload: { tokenId: 'testToken' } } as ReceiveFromHub;
      const messageId = 'messageId';
      const sourceChain = 'sourceChain';
      const sourceAddress = 'sourceAddress';
      const availableGasBalance = '100';
      jest.spyOn(service, 'deployTokenManagerContract').mockResolvedValue({
        success: true,
        transaction: {
          tx_id: 'mockDeployTxId',
          tx_type: 'smart_contract',
          smart_contract: { contract_id: 'mockContractAddress.mockContractName' } as any,
        } as any,
      });
      jest.spyOn(service, 'setupTokenManagerContract').mockResolvedValue({
        success: false,
        transaction: null,
      });
      jest.spyOn(service, 'executeDeployTokenManager').mockImplementation(jest.fn());
      mockTransactionsHelper.checkAvailableGasBalance.mockResolvedValue(true);
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));
      (tokenManagerParamsDecoder as jest.Mock).mockReturnValue({
        operator: 'mockOperator',
        tokenAddress: 'mockTokenAddress',
      });
      await expect(
        service.handleDeployTokenManager(
          senderKey,
          message,
          messageId,
          sourceChain,
          sourceAddress,
          availableGasBalance,
        ),
      ).rejects.toThrow('Could not setup token manager, hash = undefined');
    });

    it('should fail if available gas balance check fails', async () => {
      const senderKey = 'senderKey';
      const message = { payload: { tokenId: 'testToken' } } as ReceiveFromHub;
      const messageId = 'messageId';
      const sourceChain = 'sourceChain';
      const sourceAddress = 'sourceAddress';
      const availableGasBalance = '100';
      jest.spyOn(service, 'deployTokenManagerContract').mockImplementation(jest.fn());
      jest.spyOn(service, 'setupTokenManagerContract').mockImplementation(jest.fn());
      jest.spyOn(service, 'executeDeployTokenManager').mockImplementation(jest.fn());
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));
      mockTransactionsHelper.checkAvailableGasBalance.mockRejectedValue(new Error('Insufficient gas balance'));
      (tokenManagerParamsDecoder as jest.Mock).mockReturnValue({
        operator: 'mockOperator',
        tokenAddress: 'mockTokenAddress',
      });
      await expect(
        service.handleDeployTokenManager(
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

  describe('setupTokenManagerContract', () => {
    const senderKey = 'mockSenderKey';
    const smartContractAddress = 'mockAddress';
    const smartContractName = 'mockName';
    const message = { messageType: HubMessageType.DeployTokenManager } as DeployTokenManager;
    const params = {
      tokenAddress: 'mockTokenAddress',
      operator: 'mockOperator',
    };

    it('should successfully setup token manager contract', async () => {
      const setupTx = { tx_id: 'mockSetupTxId' } as any;

      mockTokenManagerContract.setup.mockResolvedValue(setupTx as any);
      mockTransactionsHelper.sendTransaction.mockResolvedValue('mockSetupHash');
      mockTransactionsHelper.awaitSuccess.mockResolvedValue({
        success: true,
        transaction: setupTx,
      });

      const result = await service.setupTokenManagerContract(
        senderKey,
        smartContractAddress,
        smartContractName,
        message,
        params,
      );

      expect(service['tokenManagerContract'].setup).toHaveBeenCalledWith(
        senderKey,
        smartContractAddress,
        smartContractName,
        message,
        params.tokenAddress,
        params.operator,
      );
      expect(mockTransactionsHelper.sendTransaction).toHaveBeenCalledWith(setupTx);
      expect(mockTransactionsHelper.awaitSuccess).toHaveBeenCalledWith('mockSetupHash');
      expect(result).toEqual({ success: true, transaction: setupTx });
    });

    it('should retry on failure and eventually succeed', async () => {
      const setupTx = { tx_id: 'mockSetupTxId' } as any;

      mockTokenManagerContract.setup.mockResolvedValue(setupTx as any);
      mockTransactionsHelper.sendTransaction.mockResolvedValue('mockSetupHash');
      mockTransactionsHelper.awaitSuccess
        .mockRejectedValueOnce(new Error('Internal server error'))
        .mockResolvedValueOnce({ success: true, transaction: setupTx });

      const result = await service.setupTokenManagerContract(
        senderKey,
        smartContractAddress,
        smartContractName,
        message,
        params,
      );

      expect(service['transactionsHelper'].awaitSuccess).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true, transaction: setupTx });
    });

    it('should throw an error if max retries are reached', async () => {
      const setupTx = { tx_id: 'mockSetupTxId' };

      mockTokenManagerContract.setup.mockResolvedValue(setupTx as any);
      mockTransactionsHelper.sendTransaction.mockResolvedValue('mockSetupHash');
      mockTransactionsHelper.awaitSuccess.mockRejectedValue(new Error('Internal server error'));

      await expect(
        service.setupTokenManagerContract(senderKey, smartContractAddress, smartContractName, message, params, 0),
      ).rejects.toThrow('Could not setup mockAddress.mockName after 3 retries');

      expect(mockTransactionsHelper.awaitSuccess).toHaveBeenCalledTimes(3);
    });
  });

  describe('setupNativeInterchainTokenContract', () => {
    const senderKey = 'mockSenderKey';
    const smartContractAddress = 'mockAddress';
    const smartContractName = 'mockName';
    const receiveFromHub = {
      messageType: HubMessageType.ReceiveFromHub,
      payload: { messageType: HubMessageType.DeployInterchainToken } as DeployInterchainToken,
      sourceChain: 'sourceChain',
    };

    it('should successfully setup native interchain token contract', async () => {
      const setupTx = { tx_id: 'mockSetupTxId' } as any;

      mockNativeInterchainTokenContract.setup.mockResolvedValue(setupTx as any);
      mockTransactionsHelper.sendTransaction.mockResolvedValue('mockSetupHash');
      mockTransactionsHelper.awaitSuccess.mockResolvedValue({
        success: true,
        transaction: setupTx,
      });

      const result = await service.setupNativeInterchainTokenContract(
        senderKey,
        smartContractAddress,
        smartContractName,
        receiveFromHub,
      );

      expect(service['nativeInterchainTokenContract'].setup).toHaveBeenCalledWith(
        senderKey,
        smartContractAddress,
        smartContractName,
        receiveFromHub.payload,
      );
      expect(mockTransactionsHelper.sendTransaction).toHaveBeenCalledWith(setupTx);
      expect(mockTransactionsHelper.awaitSuccess).toHaveBeenCalledWith('mockSetupHash');
      expect(result).toEqual({ success: true, transaction: setupTx });
    });

    it('should retry on failure and eventually succeed', async () => {
      const setupTx = { tx_id: 'mockSetupTxId' } as any;

      mockNativeInterchainTokenContract.setup.mockResolvedValue(setupTx as any);
      mockTransactionsHelper.sendTransaction.mockResolvedValue('mockSetupHash');
      mockTransactionsHelper.awaitSuccess
        .mockRejectedValueOnce(new Error('Internal server error'))
        .mockResolvedValueOnce({ success: true, transaction: setupTx });

      const result = await service.setupNativeInterchainTokenContract(
        senderKey,
        smartContractAddress,
        smartContractName,
        receiveFromHub,
      );

      expect(mockTransactionsHelper.awaitSuccess).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true, transaction: setupTx });
    });

    it('should throw an error if max retries are reached', async () => {
      const setupTx = { tx_id: 'mockSetupTxId' };

      mockNativeInterchainTokenContract.setup.mockResolvedValue(setupTx as any);
      mockTransactionsHelper.sendTransaction.mockResolvedValue('mockSetupHash');
      mockTransactionsHelper.awaitSuccess.mockRejectedValue(new Error('Internal server error'));

      await expect(
        service.setupNativeInterchainTokenContract(
          senderKey,
          smartContractAddress,
          smartContractName,
          receiveFromHub,
          0,
        ),
      ).rejects.toThrow('Could not setup mockAddress.mockName after 3 retries');

      expect(mockTransactionsHelper.awaitSuccess).toHaveBeenCalledTimes(3);
    });
  });

  describe('handleVerifyCall', () => {
    const senderKey = 'mockSenderKey';
    const payload = 'mockPayload';
    const messageId = 'mockMessageId';
    const sourceChain = 'mockSourceChain';
    const sourceAddress = 'mockSourceAddress';
    const availableGasBalance = '100';

    it('should handle VERIFY_INTERCHAIN_TOKEN type', async () => {
      const interchainTokenData = { tokenAddress: 'mockTokenAddress' };
      jest
        .spyOn(DecodingUtils, 'deserialize')
        .mockReturnValue({ value: { type: { value: VerifyMessageType.VERIFY_INTERCHAIN_TOKEN } } });
      (verifyInterchainTokenDecoder as jest.Mock).mockReturnValue(interchainTokenData);
      const mockTransaction = { tx_id: 'mockTxId' } as any;
      jest.spyOn(service, 'executeDeployInterchainToken').mockResolvedValue(mockTransaction);
      mockTransactionsHelper.checkAvailableGasBalance.mockResolvedValue(true);

      const result = await service.handleVerifyCall(
        senderKey,
        payload,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
      );

      expect(DecodingUtils.deserialize).toHaveBeenCalledWith(payload);
      expect(service.executeDeployInterchainToken).toHaveBeenCalled();
      expect(mockTransactionsHelper.checkAvailableGasBalance).toHaveBeenCalledWith(messageId, availableGasBalance, [
        { transaction: mockTransaction },
      ]);
      expect(result).toEqual(mockTransaction);
    });

    it('should handle VERIFY_TOKEN_MANAGER type', async () => {
      const tokenManagerData = {
        tokenManagerAddress: 'mockManagerAddress',
        tokenType: 'mockTokenType',
      };
      jest
        .spyOn(DecodingUtils, 'deserialize')
        .mockReturnValue({ value: { type: { value: VerifyMessageType.VERIFY_TOKEN_MANAGER } } });
      (verifyTokenManagerDecoder as jest.Mock).mockReturnValue(tokenManagerData);
      jest.spyOn(service, 'getTokenAddress').mockResolvedValue('mockTokenAddress');
      const mockTransaction = { tx_id: 'mockTxId' } as any;
      jest.spyOn(service, 'executeDeployTokenManager').mockResolvedValue(mockTransaction);
      mockTransactionsHelper.checkAvailableGasBalance.mockResolvedValue(true);

      const result = await service.handleVerifyCall(
        senderKey,
        payload,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
      );

      expect(service.getTokenAddress).toHaveBeenCalledWith({
        managerAddress: tokenManagerData.tokenManagerAddress,
        tokenType: tokenManagerData.tokenType,
      });
      expect(service.executeDeployTokenManager).toHaveBeenCalled();
      expect(mockTransactionsHelper.checkAvailableGasBalance).toHaveBeenCalledWith(messageId, availableGasBalance, [
        { transaction: mockTransaction },
      ]);
      expect(result).toEqual(mockTransaction);
    });

    it('should return null for unknown type', async () => {
      jest.spyOn(DecodingUtils, 'deserialize').mockReturnValue({ value: { type: { value: 'UNKNOWN_TYPE' } } });

      const result = await service.handleVerifyCall(
        senderKey,
        payload,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
      );

      expect(result).toBeNull();
    });

    it('should throw an error if decoding fails', async () => {
      jest.spyOn(DecodingUtils, 'deserialize').mockImplementation(() => {
        throw new Error('Decoding error');
      });

      await expect(
        service.handleVerifyCall(senderKey, payload, messageId, sourceChain, sourceAddress, availableGasBalance),
      ).rejects.toThrow('Decoding error');
    });

    it('should handle VERIFY_TOKEN_MANAGER with insufficient gas balance', async () => {
      const tokenManagerData = {
        tokenManagerAddress: 'mockManagerAddress',
        tokenType: 'mockTokenType',
      };
      jest
        .spyOn(DecodingUtils, 'deserialize')
        .mockReturnValue({ value: { type: { value: VerifyMessageType.VERIFY_TOKEN_MANAGER } } });
      (verifyTokenManagerDecoder as jest.Mock).mockReturnValue(tokenManagerData);
      jest.spyOn(service, 'getTokenAddress').mockResolvedValue('mockTokenAddress');
      const mockTransaction = { tx_id: 'mockTxId' } as any;
      jest.spyOn(service, 'executeDeployTokenManager').mockResolvedValue(mockTransaction);
      mockTransactionsHelper.checkAvailableGasBalance.mockRejectedValue(new Error('Insufficient gas balance'));

      await expect(
        service.handleVerifyCall(senderKey, payload, messageId, sourceChain, sourceAddress, availableGasBalance),
      ).rejects.toThrow('Insufficient gas balance');
    });

    it('should handle VERIFY_INTERCHAIN_TOKEN with insufficient gas balance', async () => {
      const interchainTokenData = { tokenAddress: 'mockTokenAddress' };
      jest
        .spyOn(DecodingUtils, 'deserialize')
        .mockReturnValue({ value: { type: { value: VerifyMessageType.VERIFY_INTERCHAIN_TOKEN } } });
      (verifyInterchainTokenDecoder as jest.Mock).mockReturnValue(interchainTokenData);
      const mockTransaction = { tx_id: 'mockTxId' } as any;
      jest.spyOn(service, 'executeDeployInterchainToken').mockResolvedValue(mockTransaction);
      mockTransactionsHelper.checkAvailableGasBalance.mockRejectedValue(new Error('Insufficient gas balance'));

      await expect(
        service.handleVerifyCall(senderKey, payload, messageId, sourceChain, sourceAddress, availableGasBalance),
      ).rejects.toThrow('Insufficient gas balance');
    });
  });
});
