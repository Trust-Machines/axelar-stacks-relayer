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
  StacksTransaction,
  stringAsciiCV,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import { bufferFromHex, stringAscii } from '@stacks/transactions/dist/cl';
import { ItsContract, ItsExtraData } from '@stacks-monorepo/common/contracts/ITS/its.contract';
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

    mockNativeInterchainTokenContract.getTemplaceContractId.mockReturnValue('mockTemplate.ContractId');
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
    it('should return null transaction for an invalid payload', async () => {
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
        null,
        undefined,
      );

      expect(result).toEqual({
        transaction: null,
        incrementRetry: true,
        extraData: null,
      });
      expect(service['handleInterchainTransfer']).not.toHaveBeenCalled();
      expect(service['handleDeployNativeInterchainToken']).not.toHaveBeenCalled();
    });

    it('should return null transaction for invalid source chain or address', async () => {
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
        null,
        undefined,
      );

      expect(result).toEqual({
        transaction: null,
        incrementRetry: true,
        extraData: null,
      });
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
        null,
        undefined,
      );

      expect(service.handleInterchainTransfer).toHaveBeenCalledWith(
        senderKey,
        receiveFromHub,
        messageId,
        sourceChain,
        'axelarContract',
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
        null,
        undefined,
      );

      expect(service.handleDeployNativeInterchainToken).toHaveBeenCalledWith(
        senderKey,
        receiveFromHub,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        null,
        undefined,
      );
    });

    it('should log an error and return null transaction for an unknown message type', async () => {
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
        null,
        undefined,
      );

      expect(result).toEqual({
        transaction: null,
        incrementRetry: true,
        extraData: null,
      });
    });
  });

  describe('handleInterchainTransfer', () => {
    it('should handle interchain transfer successfully', async () => {
      const senderKey = 'senderKey';
      const messageId = 'messageId';
      const sourceChain = 'itsHubChain';
      const sourceAddress = 'itsHubAddress';
      const availableGasBalance = '100';
      const message = {
        messageType: HubMessageType.ReceiveFromHub,
        sourceChain: sourceChain,
        payload: {
          tokenId: 'tokenId',
          senderAddress: 'sourceAddress',
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
        sourceAddress,
        availableGasBalance,
      );

      expect(service.getTokenInfo).toHaveBeenCalledWith(message.payload.tokenId);
      expect(service.executeReceiveInterchainToken).toHaveBeenCalledWith(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        tokenInfo,
        availableGasBalance,
      );
      expect(result).toEqual(transactionMock);
    });

    it('should throw an error if token info cannot be fetched', async () => {
      const senderKey = 'senderKey';
      const messageId = 'messageId';
      const sourceChain = 'itsHubChain';
      const sourceAddress = 'itsHubAddress';
      const availableGasBalance = '100';
      const message = {
        messageType: HubMessageType.ReceiveFromHub,
        sourceChain: sourceChain,
        payload: {
          tokenId: 'tokenId',
          senderAddress: 'sourceAddress',
          data: '',
        },
      } as ReceiveFromHub;

      jest.spyOn(service, 'getTokenInfo' as any).mockResolvedValue(null);
      jest.spyOn(service as any, 'executeReceiveInterchainToken').mockResolvedValue(undefined);

      await expect(
        service.handleInterchainTransfer(senderKey, message, messageId, sourceChain, sourceAddress, availableGasBalance),
      ).rejects.toThrow('Could not get token info');
      expect(service['getTokenInfo']).toHaveBeenCalledWith(message.payload.tokenId);
      expect(service['executeReceiveInterchainToken']).not.toHaveBeenCalled();
    });
  });

  describe('handleDeployNativeInterchainToken', () => {
    const senderKey = 'senderKey';
    const message = {
      messageType: HubMessageType.ReceiveFromHub,
      payload: { name: 'tokenName', messageType: HubMessageType.DeployInterchainToken } as DeployInterchainToken,
    } as ReceiveFromHub;
    const messageId = 'messageId';
    const sourceChain = 'axelar';
    const sourceAddress = 'axelarContract';
    const availableGasBalance = '100';

    it('should handle first step contract deploy only', async () => {
      const deployTx = createMock<StacksTransaction>();
      deployTx.txid.mockReturnValue('txId');
      const setupTx = createMock<StacksTransaction>();
      const executeTx = createMock<StacksTransaction>();

      mockNativeInterchainTokenContract.deployContractTransaction.mockResolvedValue({
        transaction: deployTx,
        contractName: 'nitContract',
      });
      mockTransactionsHelper.makeContractId.mockReturnValue('address.contractId-1000');
      jest.spyOn(Date, 'now').mockReturnValue(1000);

      // For checkDeployInterchainTokenGasBalance
      mockNativeInterchainTokenContract.setupTransaction.mockResolvedValue(setupTx);
      jest.spyOn(service as any, 'executeDeployInterchainToken').mockResolvedValue(executeTx);
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));

      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        null,
        undefined,
      );

      expect(result).toEqual({
        transaction: deployTx,
        incrementRetry: false,
        extraData: {
          step: 'CONTRACT_DEPLOY',
          contractId: 'address.contractId-1000',
          timestamp: 1000,
          deployTxHash: 'txId',
        },
      });

      // From checkDeployInterchainTokenGasBalance
      expect(mockNativeInterchainTokenContract.getTemplaceContractId).toHaveBeenCalledTimes(1);
      expect(mockNativeInterchainTokenContract.getTemplateDeployVerificationParams).toHaveBeenCalledTimes(1);

      expect(mockNativeInterchainTokenContract.deployContractTransaction).toHaveBeenCalledTimes(2);
      // First time for simulate
      expect(mockNativeInterchainTokenContract.deployContractTransaction).toHaveBeenCalledWith(
        senderKey,
        (message.payload as DeployInterchainToken).name,
        true,
      );
      expect(mockNativeInterchainTokenContract.deployContractTransaction).toHaveBeenCalledWith(
        senderKey,
        (message.payload as DeployInterchainToken).name,
      );

      expect(mockNativeInterchainTokenContract.setupTransaction).toHaveBeenCalledTimes(1);
      expect(mockNativeInterchainTokenContract.setupTransaction).toHaveBeenCalledWith(
        senderKey,
        'mockTemplate',
        'ContractId',
        message.payload,
        true,
      );
      expect(service.executeDeployInterchainToken).toHaveBeenCalledWith(
        senderKey,
        expect.anything(),
        messageId,
        sourceChain,
        sourceAddress,
        'mockTemplate.ContractId',
        deployTx,
        true,
      );
      expect(mockTransactionsHelper.makeContractId).toHaveBeenCalledTimes(1);

      // On retry, which can happen in case deploy transaction timeout exceeded
      const result2 = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        null,
        {
          step: 'CONTRACT_DEPLOY',
          contractId: 'address.oldContractId',
          timestamp: 1,
          deployTxHash: 'other',
        },
      );

      expect(result2).toEqual({
        transaction: deployTx,
        incrementRetry: false,
        extraData: {
          step: 'CONTRACT_DEPLOY',
          contractId: 'address.contractId-1000',
          timestamp: 1000,
          deployTxHash: 'txId',
        },
      });
    });

    it('should handle first step contract deploy in progress', async () => {
      mockTransactionsHelper.isTransactionSuccessfulWithTimeout.mockResolvedValueOnce({
        isFinished: false,
        success: false,
      });

      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        'executeTxHash',
        {
          step: 'CONTRACT_DEPLOY',
          contractId: 'address.contractId-1000',
          timestamp: 1000,
          deployTxHash: 'txId',
        },
      );

      expect(result).toEqual({
        transaction: null,
        incrementRetry: false,
        extraData: {
          step: 'CONTRACT_DEPLOY',
          contractId: 'address.contractId-1000',
          timestamp: 1000,
          deployTxHash: 'txId',
        },
      });

      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith('executeTxHash', 1000);
    });

    it('should handle first step contract deploy failed', async () => {
      mockTransactionsHelper.isTransactionSuccessfulWithTimeout.mockResolvedValueOnce({
        isFinished: true,
        success: false,
      });

      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        'executeTxHash',
        {
          step: 'CONTRACT_DEPLOY',
          contractId: 'address.contractId-1000',
          timestamp: 1000,
          deployTxHash: 'txId',
        },
      );

      expect(result).toEqual({
        transaction: null,
        incrementRetry: true,  // retry will be incremented
        extraData: {
          step: 'CONTRACT_DEPLOY',
          contractId: 'address.contractId-1000',
          timestamp: 1000,
          deployTxHash: 'txId',
        },
      });

      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith('executeTxHash', 1000);
    });

    it('should handle second step contract setup after contract deploy succeeded', async () => {
      mockTransactionsHelper.isTransactionSuccessfulWithTimeout.mockResolvedValueOnce({
        isFinished: true,
        success: true,
      });

      const setupTx = createMock<StacksTransaction>();
      mockNativeInterchainTokenContract.setupTransaction.mockResolvedValue(setupTx);
      jest.spyOn(Date, 'now').mockReturnValue(2000);

      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        'executeTxHash',
        {
          step: 'CONTRACT_DEPLOY',
          contractId: 'address.contractId-1000',
          timestamp: 1000,
          deployTxHash: 'txId',
        },
      );

      expect(result).toEqual({
        transaction: setupTx,
        incrementRetry: false,
        extraData: {
          step: 'CONTRACT_SETUP',
          contractId: 'address.contractId-1000',
          timestamp: 2000,
          deployTxHash: 'txId',
        },
      });

      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith('executeTxHash', 1000);

      expect(mockNativeInterchainTokenContract.setupTransaction).toHaveBeenCalledTimes(1);
      expect(mockNativeInterchainTokenContract.setupTransaction).toHaveBeenCalledWith(
        senderKey,
        'address',
        'contractId-1000',
        message.payload,
      );
    });

    it('should handle second step contract setup in progress', async () => {
      mockTransactionsHelper.isTransactionSuccessfulWithTimeout.mockResolvedValueOnce({
        isFinished: false,
        success: false,
      });

      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        'executeTxHash',
        {
          step: 'CONTRACT_SETUP',
          contractId: 'address.contractId-1000',
          timestamp: 2000,
          deployTxHash: 'txId',
        },
      );

      expect(result).toEqual({
        transaction: null,
        incrementRetry: false,
        extraData: {
          step: 'CONTRACT_SETUP',
          contractId: 'address.contractId-1000',
          timestamp: 2000,
          deployTxHash: 'txId',
        },
      });

      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith('executeTxHash', 2000);
    });

    it('should handle second step contract setup failed', async () => {
      mockTransactionsHelper.isTransactionSuccessfulWithTimeout.mockResolvedValueOnce({
        isFinished: true,
        success: false,
      });

      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        'executeTxHash',
        {
          step: 'CONTRACT_SETUP',
          contractId: 'address.contractId-1000',
          timestamp: 2000,
          deployTxHash: 'txId',
        },
      );

      expect(result).toEqual({
        transaction: null,
        incrementRetry: true,  // retry will be incremented
        extraData: {
          step: 'CONTRACT_SETUP',
          contractId: 'address.contractId-1000',
          timestamp: 2000,
          deployTxHash: 'txId',
        },
      });

      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith('executeTxHash', 2000);
    });

    it('should handle third step execute after contract setup suceeded', async () => {
      mockTransactionsHelper.isTransactionSuccessfulWithTimeout.mockResolvedValueOnce({
        isFinished: true,
        success: true,
      });

      const executeTx = createMock<StacksTransaction>();
      jest.spyOn(service as any, 'executeDeployInterchainToken').mockResolvedValue(executeTx);
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));

      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        'executeTxHash',
        {
          step: 'CONTRACT_SETUP',
          contractId: 'address.contractId-1000',
          timestamp: 2000,
          deployTxHash: 'txId',
        },
      );

      expect(result).toEqual({
        transaction: executeTx,
        incrementRetry: false,
        extraData: {
          step: 'ITS_EXECUTE',
          contractId: 'address.contractId-1000',
          timestamp: undefined,
          deployTxHash: 'txId',
        },
      });

      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith('executeTxHash', 2000);

      expect(mockVerifyOnchain.buildNativeInterchainTokenVerificationParams).toHaveBeenCalledTimes(1);

      expect(service.executeDeployInterchainToken).toHaveBeenCalledWith(
        senderKey,
        expect.anything(),
        messageId,
        sourceChain,
        sourceAddress,
        'address.contractId-1000',
        tupleCV({}),
      );
    });

    it('should handle third step execute in progress', async () => {
      mockTransactionsHelper.isTransactionSuccessfulWithTimeout.mockResolvedValueOnce({
        isFinished: false,
        success: false,
      });

      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        'executeTxHash',
        {
          step: 'ITS_EXECUTE',
          contractId: 'address.contractId-1000',
          timestamp: undefined,
          deployTxHash: 'txId',
        },
      );

      expect(result).toEqual({
        transaction: null,
        incrementRetry: false,
        extraData: {
          step: 'ITS_EXECUTE',
          contractId: 'address.contractId-1000',
          timestamp: undefined,
          deployTxHash: 'txId',
        },
      });

      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith('executeTxHash', undefined);
    });

    it('should handle third step execute failed', async () => {
      mockTransactionsHelper.isTransactionSuccessfulWithTimeout.mockResolvedValueOnce({
        isFinished: true,
        success: false,
      });

      const result = await service.handleDeployNativeInterchainToken(
        senderKey,
        message,
        messageId,
        sourceChain,
        sourceAddress,
        availableGasBalance,
        'executeTxHash',
        {
          step: 'ITS_EXECUTE',
          contractId: 'address.contractId-1000',
          timestamp: undefined,
          deployTxHash: 'txId',
        },
      );

      expect(result).toEqual({
        transaction: null,
        incrementRetry: true, // retry will be incremented
        extraData: {
          step: 'ITS_EXECUTE',
          contractId: 'address.contractId-1000',
          timestamp: undefined,
          deployTxHash: 'txId',
        },
      });

      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(mockTransactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith('executeTxHash', undefined);
    });

    it('should fail if available gas balance check fails', async () => {
      const deployTx = createMock<StacksTransaction>();
      deployTx.txid.mockReturnValue('txId');
      const setupTx = createMock<StacksTransaction>();
      const executeTx = createMock<StacksTransaction>();

      mockNativeInterchainTokenContract.deployContractTransaction.mockResolvedValue({
        transaction: deployTx,
        contractName: 'nitContract',
      });
      mockTransactionsHelper.makeContractId.mockReturnValue('address.contractId-1000');
      jest.spyOn(Date, 'now').mockReturnValue(1000);

      mockNativeInterchainTokenContract.setupTransaction.mockResolvedValue(setupTx);
      jest.spyOn(service as any, 'executeDeployInterchainToken').mockResolvedValue(executeTx);
      jest.spyOn(HubMessage, 'clarityEncode').mockReturnValue(stringAscii('payload'));

      mockTransactionsHelper.checkAvailableGasBalance.mockRejectedValue(new Error('Insufficient gas balance'));
      await expect(
        service.handleDeployNativeInterchainToken(
          senderKey,
          message,
          messageId,
          sourceChain,
          sourceAddress,
          availableGasBalance,
          null,
          {} as unknown as ItsExtraData,
        ),
      ).rejects.toThrow('Insufficient gas balance');

      expect(mockTransactionsHelper.checkAvailableGasBalance).toHaveBeenCalledTimes(1);
      expect(mockTransactionsHelper.checkAvailableGasBalance).toHaveBeenCalledWith(
        messageId,
        availableGasBalance,
        expect.anything(),
      );
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
