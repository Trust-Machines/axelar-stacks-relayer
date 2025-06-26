import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { CacheInfo, GasServiceContract, TransactionsHelper } from '@stacks-monorepo/common';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksNetwork } from '@stacks/network';
import { StacksTransaction } from '@stacks/transactions';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { StacksTransactionRepository } from '@stacks-monorepo/common/database/repository/stacks-transaction.repository';
import { StacksTransactionProcessorService } from './stacks-transaction.processor.service';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { StacksTransaction as PrismaStacksTransaction } from '@prisma/client';
import RefundTask = Components.Schemas.RefundTask;

const mockDate = new Date('2023-05-14');
jest.useFakeTimers().setSystemTime(mockDate);

const mockExecuteData = Buffer.from(
  '0c00000003046461746102000001210b000000010c0000000510636f6e74726163742d61646472657373061a2ffa5b05761d84adca1ad9215e7a7efdeddb10fe0b68656c6c6f2d776f726c640a6d6573736167652d69640d000000443078363432383430626531303961386530326564316637663635626137633165643539396133383137393666386233343032313164363435313161663761386131372d300c7061796c6f61642d686173680200000020af6b8f9d6a366d59d2851d7fd30a10c430dc949470ad50a13f5655b945f9c8830e736f757263652d616464726573730d0000002a3078634534313033383637434334426662323338324536443042374638386536453346384435363344360c736f757263652d636861696e0d0000000e6176616c616e6368652d66756a690866756e6374696f6e0d00000010617070726f76652d6d657373616765730570726f6f6602000001df0c000000020a7369676e6174757265730b0000000202000000419f1be5d20bb51f35a9b78e0c33673e2f7137b1227ff03f469adc3e4169f5be020d3d437d5188642086ff6ac44ff6fdcfdb293dc43f30cf13b94cd0b1fe5dcd9b010200000041cbc6f69b0d7a14e026ebfe6d7e97870ff1ff1adb961161492d7d60843ea32ae3576626ef6062c9e1779f95dbf956ece0793b35270545a35a4fea5fe24f60a4fe01077369676e6572730c00000003056e6f6e63650200000020000000000000000000000000000000000000000000000000000000000038d32c077369676e6572730b000000030c00000002067369676e65720200000021026e4a6fc3a6988c4cd7d3bc02e07bac8b72a9f5342d92f42161e7b6e57dd47e180677656967687401000000000000000000000000000000010c00000002067369676e6572020000002102d19c406d763c98d98554c980ae03543b936aad0c3f1289a367a0c2aafb71e8c10677656967687401000000000000000000000000000000010c00000002067369676e6572020000002103ea531f69879b3b15b6e3fe262250d5ceca6217e03e4def6919d4bdce3a7ec389067765696768740100000000000000000000000000000001097468726573686f6c640100000000000000000000000000000002==',
  'hex',
).toString('base64');
const mockDataDecoded = {
  data: '0x0b000000010c0000000510636f6e74726163742d61646472657373061a2ffa5b05761d84adca1ad9215e7a7efdeddb10fe0b68656c6c6f2d776f726c640a6d6573736167652d69640d000000443078363432383430626531303961386530326564316637663635626137633165643539396133383137393666386233343032313164363435313161663761386131372d300c7061796c6f61642d686173680200000020af6b8f9d6a366d59d2851d7fd30a10c430dc949470ad50a13f5655b945f9c8830e736f757263652d616464726573730d0000002a3078634534313033383637434334426662323338324536443042374638386536453346384435363344360c736f757263652d636861696e0d0000000e6176616c616e6368652d66756a69',
  function: 'approve-messages',
  proof:
    '0x0c000000020a7369676e6174757265730b0000000202000000419f1be5d20bb51f35a9b78e0c33673e2f7137b1227ff03f469adc3e4169f5be020d3d437d5188642086ff6ac44ff6fdcfdb293dc43f30cf13b94cd0b1fe5dcd9b010200000041cbc6f69b0d7a14e026ebfe6d7e97870ff1ff1adb961161492d7d60843ea32ae3576626ef6062c9e1779f95dbf956ece0793b35270545a35a4fea5fe24f60a4fe01077369676e6572730c00000003056e6f6e63650200000020000000000000000000000000000000000000000000000000000000000038d32c077369676e6572730b000000030c00000002067369676e65720200000021026e4a6fc3a6988c4cd7d3bc02e07bac8b72a9f5342d92f42161e7b6e57dd47e180677656967687401000000000000000000000000000000010c00000002067369676e6572020000002102d19c406d763c98d98554c980ae03543b936aad0c3f1289a367a0c2aafb71e8c10677656967687401000000000000000000000000000000010c00000002067369676e6572020000002103ea531f69879b3b15b6e3fe262250d5ceca6217e03e4def6919d4bdce3a7ec389067765696768740100000000000000000000000000000001097468726573686f6c640100000000000000000000000000000002',
};

describe('TransactionsProcessorService', () => {
  let redisHelper: DeepMocked<RedisHelper>;
  let walletSigner: string;
  let transactionsHelper: DeepMocked<TransactionsHelper>;
  let gatewayContract: DeepMocked<GatewayContract>;
  let mockNetwork: DeepMocked<StacksNetwork>;
  let slackApi: DeepMocked<SlackApi>;
  let stacksTransactionRepository: DeepMocked<StacksTransactionRepository>;
  let gasServiceContract: DeepMocked<GasServiceContract>;
  let hiroApiHelper: DeepMocked<HiroApiHelper>;

  let service: StacksTransactionProcessorService;

  beforeEach(async () => {
    redisHelper = createMock();
    transactionsHelper = createMock();
    gatewayContract = createMock();
    walletSigner = 'mocked-wallet-signer';
    slackApi = createMock();
    stacksTransactionRepository = createMock();
    gasServiceContract = createMock();
    hiroApiHelper = createMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        StacksTransactionProcessorService,
        {
          provide: ProviderKeys.STACKS_NETWORK,
          useValue: mockNetwork,
        },
      ],
    })
      .useMocker((token) => {
        if (token === RedisHelper) {
          return redisHelper;
        }

        if (token === ProviderKeys.WALLET_SIGNER) {
          return walletSigner;
        }

        if (token === TransactionsHelper) {
          return transactionsHelper;
        }

        if (token === GatewayContract) {
          return gatewayContract;
        }

        if (token === SlackApi) {
          return slackApi;
        }

        if (token === StacksTransactionRepository) {
          return stacksTransactionRepository;
        }

        if (token === GasServiceContract) {
          return gasServiceContract;
        }

        if (token === HiroApiHelper) {
          return hiroApiHelper;
        }

        return null;
      })
      .compile();

    gasServiceContract.getGasImpl.mockResolvedValue('contract_impl_address.contract_impl_name');

    service = moduleRef.get(StacksTransactionProcessorService);
  });

  it('Should handle invalid type', async () => {
    const result = await service.handlePendingTransactionsRaw([
      {
        taskItemId: 'taskItemId',
        type: 'INVALID' as any,
        status: 'PENDING',
        extraData: {},
        txHash: null,
        retry: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    expect(slackApi.sendError).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].status).toEqual('FAILED');
  });

  describe('processGatewayTx', () => {
    it('Should handle GATEWAY send', async () => {
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));
      transactionsHelper.getTransactionGas.mockReturnValueOnce(Promise.resolve('100000000'));
      redisHelper.get.mockResolvedValueOnce(undefined);

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'GATEWAY',
          status: 'PENDING',
          extraData: {
            executeData: mockExecuteData,
          },
          txHash: null,
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).not.toHaveBeenCalled();
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledTimes(2);
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledWith(mockDataDecoded, walletSigner);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 0, mockNetwork);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalled();
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
      expect(redisHelper.set).toHaveBeenCalledWith(
        CacheInfo.GatewayTxFee(0).key,
        '100000000',
        CacheInfo.GatewayTxFee(0).ttl,
      );
      expect(result).toHaveLength(1);
      expect(result[0].txHash).toEqual('txHash');
    });
    it('Should handle GATEWAY send invalid extraData', async () => {
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));
      transactionsHelper.getTransactionGas.mockReturnValueOnce(Promise.resolve('100000000'));
      redisHelper.get.mockResolvedValueOnce(undefined);

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'GATEWAY',
          status: 'PENDING',
          extraData: {},
          txHash: null,
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).not.toHaveBeenCalled();
      expect(slackApi.sendError).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].status).toEqual('FAILED');
    });
    it('Should handle GATEWAY success', async () => {
      transactionsHelper.isTransactionSuccessfulWithTimeout.mockReturnValueOnce(
        Promise.resolve({
          success: true,
          isFinished: true,
        }),
      );
      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'INVALID' as any,
          status: 'PENDING',
          extraData: {
            executeData: mockExecuteData,
          },
          txHash: 'txHashComplete',
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith(
        'txHashComplete',
        expect.anything(),
      );
      expect(transactionsHelper.getTransactionGas).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].status).toEqual('SUCCESS');
    });

    it('Should handle wait until finished', async () => {
      transactionsHelper.isTransactionSuccessfulWithTimeout.mockReturnValueOnce(
        Promise.resolve({
          success: false,
          isFinished: false,
        }),
      );

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'INVALID' as any,
          status: 'PENDING',
          extraData: {
            executeData: mockExecuteData,
          },
          txHash: 'txHashComplete',
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith(
        'txHashComplete',
        expect.anything(),
      );
      expect(result).toHaveLength(0);
    });

    it('Should handle retry', async () => {
      transactionsHelper.isTransactionSuccessfulWithTimeout.mockReturnValueOnce(
        Promise.resolve({
          success: false,
          isFinished: true,
        }),
      );
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));
      transactionsHelper.getTransactionGas.mockReturnValueOnce(Promise.resolve('100000000'));
      redisHelper.get.mockResolvedValueOnce(undefined);

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'GATEWAY',
          status: 'PENDING',
          extraData: {
            executeData: mockExecuteData,
          },
          txHash: 'txHash',
          retry: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith('txHash', expect.anything());
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledTimes(2);
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledWith(mockDataDecoded, walletSigner);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 1, mockNetwork);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].status).toEqual('PENDING');
      expect(result[0].retry).toEqual(2);
    });

    it('Should not handle final retry', async () => {
      transactionsHelper.isTransactionSuccessfulWithTimeout.mockReturnValueOnce(
        Promise.resolve(
          Promise.resolve({
            success: false,
            isFinished: true,
          }),
        ),
      );

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'INVALID' as any,
          status: 'PENDING',
          extraData: {
            executeData: mockExecuteData,
          },
          txHash: 'txHashComplete',
          retry: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith(
        'txHashComplete',
        expect.anything(),
      );
      expect(transactionsHelper.getTransactionGas).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].status).toEqual('FAILED');
    });

    it('Should handle retry error', async () => {
      transactionsHelper.isTransactionSuccessfulWithTimeout.mockReturnValueOnce(
        Promise.resolve({
          success: false,
          isFinished: true,
        }),
      );
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.getTransactionGas.mockRejectedValueOnce(new Error('Network error'));
      redisHelper.get.mockResolvedValueOnce(undefined);

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'GATEWAY',
          status: 'PENDING',
          extraData: {
            executeData: mockExecuteData,
          },
          txHash: 'txHashComplete',
          retry: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).toHaveBeenCalledWith(
        'txHashComplete',
        expect.anything(),
      );
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 1, mockNetwork);
      expect(result).toHaveLength(0);
    });
  });

  describe('processRefundTask', () => {
    function assertRefundSuccess(senderKey: string, transaction: StacksTransaction, result: PrismaStacksTransaction[]) {
      expect(gasServiceContract.refund).toHaveBeenCalledTimes(1);
      expect(gasServiceContract.refund).toHaveBeenCalledWith(
        senderKey,
        expect.anything(),
        '0xmessageTxHash',
        '1',
        'recipientAddress',
        '1000',
      );
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledWith(transaction);

      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).not.toHaveBeenCalled();
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].txHash).toEqual('txHash');
    }

    it('Should handle REFUND send', async () => {
      const refundTask: RefundTask = {
        refundRecipientAddress: 'address',
        remainingGasBalance: {
          amount: '0',
        },
        message: {
          messageID: '',
          payloadHash: '',
          sourceChain: '',
          sourceAddress: '',
          destinationAddress: '',
        },
      };

      const transaction: DeepMocked<StacksTransaction> = createMock();
      gasServiceContract.refund.mockResolvedValueOnce(transaction);
      transactionsHelper.sendTransaction.mockResolvedValue('txHash');

      hiroApiHelper.getAccountBalance.mockResolvedValue({
        stx: {
          balance: '100',
        },
      } as any);

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'REFUND',
          status: 'PENDING',
          extraData: refundTask as any,
          txHash: null,
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).not.toHaveBeenCalled();
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].txHash).toEqual('txHash');
    });

    it('Should handle REFUND send invalid extraData', async () => {
      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'REFUND',
          status: 'PENDING',
          extraData: {},
          txHash: null,
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(transactionsHelper.isTransactionSuccessfulWithTimeout).not.toHaveBeenCalled();
      expect(slackApi.sendError).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].status).toEqual('FAILED');
    });

    it('Should handle process refund task STX success', async () => {
      const refundTask = {
        refundRecipientAddress: 'recipientAddress',
        remainingGasBalance: {
          amount: '1000',
        },
        message: {
          messageID: '0xmessageTxHash-1',
          payloadHash: '',
          sourceChain: '',
          sourceAddress: '',
          destinationAddress: '',
        },
      } as RefundTask;

      hiroApiHelper.getAccountBalance.mockResolvedValue({
        stx: {
          balance: '10000',
        },
      } as any);

      const transaction: DeepMocked<StacksTransaction> = createMock();
      gasServiceContract.refund.mockResolvedValueOnce(transaction);

      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'REFUND',
          status: 'PENDING',
          extraData: refundTask as any,
          txHash: null,
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(hiroApiHelper.getAccountBalance).toHaveBeenCalledTimes(1);

      assertRefundSuccess(walletSigner, transaction, result);
    });

    it('Should handle process refund task TOKEN success', async () => {
      const refundTask = {
        refundRecipientAddress: 'recipientAddress',
        remainingGasBalance: {
          amount: '1000',
          tokenID: 'TOKEN-123456',
        },
        message: {
          messageID: '0xmessageTxHash-1',
          payloadHash: '',
          sourceChain: '',
          sourceAddress: '',
          destinationAddress: '',
        },
      } as RefundTask;

      hiroApiHelper.getAccountBalance.mockResolvedValue({
        fungible_tokens: {
          'TOKEN-123456': {
            balance: '10000',
            total_sent: '0',
            total_received: '10000',
          },
        },
      } as any);

      const transaction: DeepMocked<StacksTransaction> = createMock();
      gasServiceContract.refund.mockResolvedValueOnce(transaction);

      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'REFUND',
          status: 'PENDING',
          extraData: refundTask as any,
          txHash: null,
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(hiroApiHelper.getAccountBalance).toHaveBeenCalledTimes(1);

      assertRefundSuccess(walletSigner, transaction, result);
    });

    it('Should handle process refund balance too low', async () => {
      const refundTask = {
        refundRecipientAddress: 'recipientAddress',
        remainingGasBalance: {
          amount: '1000',
          tokenID: '',
        },
        message: {
          messageID: '0xmessageTxHash-1',
          payloadHash: '',
          sourceChain: '',
          sourceAddress: '',
          destinationAddress: '',
        },
      } as RefundTask;

      hiroApiHelper.getAccountBalance.mockResolvedValue({
        stx: {
          balance: '999',
        },
      } as any);

      const transaction: DeepMocked<StacksTransaction> = createMock();
      gasServiceContract.refund.mockResolvedValueOnce(transaction);

      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'REFUND',
          status: 'PENDING',
          extraData: refundTask as any,
          txHash: null,
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(hiroApiHelper.getAccountBalance).toHaveBeenCalledTimes(1);

      expect(gasServiceContract.refund).not.toHaveBeenCalled();
      expect(transactionsHelper.sendTransaction).not.toHaveBeenCalled();
      expect(slackApi.sendError).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].status).toEqual('PENDING');
    });

    it('Should handle process refund task TOKEN balance too low', async () => {
      const refundTask = {
        refundRecipientAddress: 'recipientAddress',
        remainingGasBalance: {
          amount: '1000',
          tokenID: 'TOKEN-123456',
        },
        message: {
          messageID: '0xmessageTxHash-1',
          payloadHash: '',
          sourceChain: '',
          sourceAddress: '',
          destinationAddress: '',
        },
      } as RefundTask;

      hiroApiHelper.getAccountBalance.mockResolvedValue({
        fungible_tokens: {
          'TOKEN-123456': {
            balance: '999',
            total_sent: '0',
            total_received: '10000',
          },
        },
      } as any);

      const transaction: DeepMocked<StacksTransaction> = createMock();
      gasServiceContract.refund.mockResolvedValueOnce(transaction);

      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));

      const result = await service.handlePendingTransactionsRaw([
        {
          taskItemId: 'taskItemId',
          type: 'REFUND',
          status: 'PENDING',
          extraData: refundTask as any,
          txHash: null,
          retry: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      expect(hiroApiHelper.getAccountBalance).toHaveBeenCalledTimes(1);

      expect(gasServiceContract.refund).not.toHaveBeenCalled();
      expect(transactionsHelper.sendTransaction).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].status).toEqual('PENDING');
    });
  });
});
