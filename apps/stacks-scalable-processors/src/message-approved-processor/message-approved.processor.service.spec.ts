import { DeepMocked, createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { MessageApproved, MessageApprovedStatus } from '@prisma/client';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { ItsContract } from '@stacks-monorepo/common/contracts/ITS/its.contract';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { ApiConfigService, AxelarGmpApi } from '@stacks-monorepo/common';
import { GasError } from '@stacks-monorepo/common/contracts/entities/gas.error';
import { TooLowAvailableBalanceError } from '@stacks-monorepo/common/contracts/entities/too-low-available-balance.error';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { MessageApprovedProcessorService } from './message-approved.processor.service';
import { StacksTransaction } from '@stacks/transactions';
import { StacksNetwork } from '@stacks/network';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';

const MAX_NUMBER_OF_RETRIES = 3;

const mockItsContractId = 'mockItsAddress.contract_name';

describe('MessageApprovedProcessorService - processPendingMessageApproved', () => {
  let service: MessageApprovedProcessorService;
  let messageApprovedRepository: DeepMocked<MessageApprovedRepository>;
  let transactionsHelper: DeepMocked<TransactionsHelper>;
  let gatewayContract: DeepMocked<GatewayContract>;
  let itsContract: DeepMocked<ItsContract>;
  let axelarGmpApi: DeepMocked<AxelarGmpApi>;
  let apiConfigService: DeepMocked<ApiConfigService>;
  let walletSigner: string;
  let mockNetwork: DeepMocked<StacksNetwork>;
  let slackApi: DeepMocked<SlackApi>;

  beforeEach(async () => {
    messageApprovedRepository = createMock();
    transactionsHelper = createMock();
    gatewayContract = createMock();
    itsContract = createMock();
    axelarGmpApi = createMock();
    apiConfigService = createMock();
    walletSigner = 'mock-wallet-signer';
    slackApi = createMock();

    apiConfigService.getContractItsProxy.mockReturnValue(mockItsContractId);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MessageApprovedProcessorService,
        {
          provide: ProviderKeys.WALLET_SIGNER,
          useValue: walletSigner,
        },
        {
          provide: ProviderKeys.STACKS_NETWORK,
          useValue: mockNetwork,
        },
      ],
    })
      .useMocker((token) => {
        if (token === MessageApprovedRepository) return messageApprovedRepository;
        if (token === TransactionsHelper) return transactionsHelper;
        if (token === GatewayContract) return gatewayContract;
        if (token === ItsContract) return itsContract;
        if (token === AxelarGmpApi) return axelarGmpApi;
        if (token === ApiConfigService) return apiConfigService;
        if (token === SlackApi) return slackApi;
        return null;
      })
      .compile();

    gatewayContract.getGatewayImpl.mockResolvedValueOnce('ST319CF5WV77KYR1H3GT0GZ7B8Q4AQPY42ETP1VPF.mockGatewayName');

    service = moduleRef.get(MessageApprovedProcessorService);
  });

  it('should process a MessageApproved entry successfully', async () => {
    const mockEntry: MessageApproved = {
      sourceChain: 'avalanche-fuji',
      messageId: 'msg1',
      status: MessageApprovedStatus.PENDING,
      sourceAddress: 'mock-source-address',
      contractAddress: 'mockContractAddress.mockContractName',
      payloadHash: 'mock-hash',
      payload: Buffer.from('mock-payload'),
      retry: 0,
      executeTxHash: null,
      availableGasBalance: '1000',
      createdAt: new Date(),
      updatedAt: new Date(),
      successTimes: null,
      taskItemId: null,
      extraData: {},
    };

    messageApprovedRepository.findPending.mockResolvedValueOnce([mockEntry]).mockResolvedValueOnce([]);
    transactionsHelper.makeContractCall.mockResolvedValueOnce({
      txid: jest.fn(() => 'mock-txid'),
      tx_id: 'mock-txid',
    } as unknown as StacksTransaction);
    transactionsHelper.checkAvailableGasBalance.mockResolvedValueOnce(true);
    transactionsHelper.sendTransactions.mockResolvedValueOnce(['mock-txid']);

    await service.processPendingMessageApproved();

    expect(messageApprovedRepository.findPending).toHaveBeenCalledTimes(2);
    expect(transactionsHelper.makeContractCall).toHaveBeenCalledTimes(1);
    expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);
    expect(messageApprovedRepository.updateManyPartial).toHaveBeenCalledTimes(1);

    // @ts-ignore
    const updatedMessageApproved: MessageApproved = messageApprovedRepository.updateManyPartial.mock.lastCall[0][0];

    expect(updatedMessageApproved.extraData).toBe(null);
    expect(updatedMessageApproved.retry).toBe(1);
    expect(updatedMessageApproved.executeTxHash).toBe('mock-txid');
  });

  it('should not process if max retries have been reached', async () => {
    const mockEntry: MessageApproved = {
      sourceChain: 'axelar',
      messageId: 'msg2',
      status: MessageApprovedStatus.PENDING,
      sourceAddress: 'mock-source-address',
      contractAddress: 'mock-contract-address',
      payloadHash: 'mock-hash',
      payload: Buffer.from('mock-payload'),
      retry: MAX_NUMBER_OF_RETRIES,
      executeTxHash: null,
      availableGasBalance: '1000',
      createdAt: new Date(),
      updatedAt: new Date(),
      successTimes: null,
      taskItemId: null,
      extraData: {},
    };

    messageApprovedRepository.findPending.mockResolvedValueOnce([mockEntry]).mockResolvedValueOnce([]);
    const handleMessageApprovedFailedSpy = jest.spyOn(service, 'handleMessageApprovedFailed');

    await service.processPendingMessageApproved();

    expect(messageApprovedRepository.updateManyPartial).toHaveBeenCalledWith([
      expect.objectContaining({ status: MessageApprovedStatus.FAILED }),
    ]);
    expect(handleMessageApprovedFailedSpy).toHaveBeenCalledWith(expect.any(Object), 'ERROR');
    expect(transactionsHelper.makeContractCall).not.toHaveBeenCalled();
  });

  it('should fail if the payload is empty', async () => {
    const mockEntry: MessageApproved = {
      sourceChain: 'axelar',
      messageId: 'msg3',
      status: MessageApprovedStatus.PENDING,
      sourceAddress: 'mock-source-address',
      contractAddress: 'mock-contract-address',
      payloadHash: 'mock-hash',
      payload: Buffer.from(''),
      retry: 0,
      executeTxHash: null,
      availableGasBalance: '1000',
      createdAt: new Date(),
      updatedAt: new Date(),
      successTimes: null,
      taskItemId: null,
      extraData: {},
    };

    messageApprovedRepository.findPending.mockResolvedValueOnce([mockEntry]).mockResolvedValueOnce([]);

    await service.processPendingMessageApproved();

    expect(messageApprovedRepository.updateManyPartial).toHaveBeenCalledWith([
      expect.objectContaining({ status: MessageApprovedStatus.FAILED }),
    ]);
    expect(transactionsHelper.makeContractCall).not.toHaveBeenCalled();
  });

  it('should retry on GasError', async () => {
    const mockEntry: MessageApproved = {
      sourceChain: 'axelar',
      messageId: 'msg4',
      status: MessageApprovedStatus.PENDING,
      sourceAddress: 'mock-source-address',
      contractAddress: 'mock-contract-address',
      payloadHash: 'mock-hash',
      payload: Buffer.from('mock-payload'),
      retry: 0,
      executeTxHash: null,
      availableGasBalance: '1000',
      createdAt: new Date(),
      updatedAt: new Date(),
      successTimes: null,
      taskItemId: null,
      extraData: {},
    };

    messageApprovedRepository.findPending.mockResolvedValueOnce([mockEntry]).mockResolvedValueOnce([]);
    transactionsHelper.makeContractCall.mockRejectedValueOnce(new GasError('Gas error'));

    await service.processPendingMessageApproved();

    expect(messageApprovedRepository.updateManyPartial).toHaveBeenCalledWith([expect.objectContaining({ retry: 1 })]);
  });

  it('should fail on TooLowAvailableBalanceError', async () => {
    const mockEntry: MessageApproved = {
      sourceChain: 'axelar',
      messageId: 'msg5',
      status: MessageApprovedStatus.PENDING,
      sourceAddress: 'mock-source-address',
      contractAddress: 'mock-contract-address',
      payloadHash: 'mock-hash',
      payload: Buffer.from('mock-payload'),
      retry: 0,
      executeTxHash: null,
      availableGasBalance: '1000',
      createdAt: new Date(),
      updatedAt: new Date(),
      successTimes: null,
      taskItemId: null,
      extraData: {},
    };

    messageApprovedRepository.findPending.mockResolvedValueOnce([mockEntry]).mockResolvedValueOnce([]);
    transactionsHelper.makeContractCall.mockRejectedValueOnce(new TooLowAvailableBalanceError('Gas too low'));
    const handleMessageApprovedFailedSpy = jest.spyOn(service, 'handleMessageApprovedFailed');

    await service.processPendingMessageApproved();

    expect(messageApprovedRepository.updateManyPartial).toHaveBeenCalledWith([
      expect.objectContaining({ status: MessageApprovedStatus.FAILED }),
    ]);
    expect(handleMessageApprovedFailedSpy).toHaveBeenCalledWith(expect.any(Object), 'INSUFFICIENT_GAS');
  });

  describe('Execute ITS', () => {
    const mockItsEntry: MessageApproved = {
      sourceChain: 'avalanche-fuji',
      messageId: 'msg1',
      status: MessageApprovedStatus.PENDING,
      sourceAddress: 'mock-source-address',
      contractAddress: mockItsContractId,
      payloadHash: 'mock-hash',
      payload: Buffer.from('mock-payload'),
      retry: 0,
      executeTxHash: null,
      availableGasBalance: '1000',
      createdAt: new Date(),
      updatedAt: new Date(),
      successTimes: null,
      taskItemId: null,
      extraData: {},
    };

    it('should process ITS entry with transaction and incrementRetry', async () => {
      messageApprovedRepository.findPending.mockResolvedValueOnce([mockItsEntry]).mockResolvedValueOnce([]);
      transactionsHelper.checkAvailableGasBalance.mockResolvedValueOnce(true);
      transactionsHelper.sendTransactions.mockResolvedValueOnce(['mock-txid']);

      itsContract.execute.mockReturnValueOnce(
        Promise.resolve({
          transaction: {
            txid: jest.fn(() => 'mock-txid'),
            tx_id: 'mock-txid',
          } as unknown as StacksTransaction,
          incrementRetry: true,
          extraData: null,
        }),
      );

      await service.processPendingMessageApproved();

      expect(messageApprovedRepository.findPending).toHaveBeenCalledTimes(2);
      expect(itsContract.execute).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.updateManyPartial).toHaveBeenCalledTimes(1);

      // @ts-ignore
      const updatedMessageApproved: MessageApproved = messageApprovedRepository.updateManyPartial.mock.lastCall[0][0];

      expect(updatedMessageApproved.extraData).toBe(null);
      expect(updatedMessageApproved.retry).toBe(1);
      expect(updatedMessageApproved.executeTxHash).toBe('mock-txid');
    });

    it('should process ITS entry with transaction and no increment retry', async () => {
      mockItsEntry.retry = 0;
      messageApprovedRepository.findPending.mockResolvedValueOnce([mockItsEntry]).mockResolvedValueOnce([]);
      transactionsHelper.checkAvailableGasBalance.mockResolvedValueOnce(true);
      transactionsHelper.sendTransactions.mockResolvedValueOnce(['mock-txid']);

      itsContract.execute.mockReturnValueOnce(
        Promise.resolve({
          transaction: {
            txid: jest.fn(() => 'mock-txid'),
            tx_id: 'mock-txid',
          } as unknown as StacksTransaction,
          incrementRetry: false,
          extraData: null,
        }),
      );

      await service.processPendingMessageApproved();

      expect(messageApprovedRepository.findPending).toHaveBeenCalledTimes(2);
      expect(itsContract.execute).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.updateManyPartial).toHaveBeenCalledTimes(1);

      // @ts-ignore
      const updatedMessageApproved: MessageApproved = messageApprovedRepository.updateManyPartial.mock.lastCall[0][0];

      expect(updatedMessageApproved.extraData).toBe(null);
      expect(updatedMessageApproved.retry).toBe(0);
      expect(updatedMessageApproved.executeTxHash).toBe('mock-txid');
    });

    it('should process ITS entry with no transaction and no retry', async () => {
      mockItsEntry.executeTxHash = 'mock-txid';
      messageApprovedRepository.findPending.mockResolvedValueOnce([mockItsEntry]).mockResolvedValueOnce([]);
      transactionsHelper.checkAvailableGasBalance.mockResolvedValueOnce(true);

      itsContract.execute.mockReturnValueOnce(
        Promise.resolve({
          transaction: null,
          incrementRetry: false,
          extraData: {
            test: 'data',
          },
        }),
      );

      await service.processPendingMessageApproved();

      expect(messageApprovedRepository.findPending).toHaveBeenCalledTimes(2);
      expect(itsContract.execute).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransactions).toHaveBeenCalledWith([]);
      expect(messageApprovedRepository.updateManyPartial).toHaveBeenCalledTimes(1);

      // @ts-ignore
      const updatedMessageApproved: MessageApproved = messageApprovedRepository.updateManyPartial.mock.lastCall[0][0];

      expect(updatedMessageApproved.extraData).toEqual({
        test: 'data',
      });
      expect(updatedMessageApproved.retry).toBe(0);
      expect(updatedMessageApproved.executeTxHash).toBe('mock-txid');
    });

    it('should process ITS entry with no transaction, increment retry and old executeTxHash', async () => {
      mockItsEntry.executeTxHash = 'mock-txid';
      messageApprovedRepository.findPending.mockResolvedValueOnce([mockItsEntry]).mockResolvedValueOnce([]);
      transactionsHelper.checkAvailableGasBalance.mockResolvedValueOnce(true);

      itsContract.execute.mockReturnValueOnce(
        Promise.resolve({
          transaction: null,
          incrementRetry: true,
          extraData: {
            test: 'data',
          },
        }),
      );

      await service.processPendingMessageApproved();

      expect(messageApprovedRepository.findPending).toHaveBeenCalledTimes(2);
      expect(itsContract.execute).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransactions).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransactions).toHaveBeenCalledWith([]);
      expect(messageApprovedRepository.updateManyPartial).toHaveBeenCalledTimes(1);

      // @ts-ignore
      const updatedMessageApproved: MessageApproved = messageApprovedRepository.updateManyPartial.mock.lastCall[0][0];

      expect(updatedMessageApproved.extraData).toEqual({
        test: 'data',
      });
      expect(updatedMessageApproved.retry).toBe(1);
      expect(updatedMessageApproved.executeTxHash).toBe(null);
    });
  });
});
