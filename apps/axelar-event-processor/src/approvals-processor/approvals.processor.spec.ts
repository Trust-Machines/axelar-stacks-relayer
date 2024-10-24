import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { MessageApprovedStatus } from '@prisma/client';
import { CacheInfo, GasServiceContract, TransactionsHelper } from '@stacks-monorepo/common';
import { AxelarGmpApi } from '@stacks-monorepo/common/api/axelar.gmp.api';
import { Components, VerifyTask } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { ApprovalsProcessorService } from './approvals.processor.service';
import GatewayTransactionTask = Components.Schemas.GatewayTransactionTask;
import TaskItem = Components.Schemas.TaskItem;
import RefundTask = Components.Schemas.RefundTask;
import ExecuteTask = Components.Schemas.ExecuteTask;
import { StacksTransaction } from '@stacks/transactions';

const mockExternalData = Buffer.from('approveMessages@61726731@61726732').toString('base64');
const mockVerifyData = Buffer.from('rotateSigners@1234@4321').toString('base64');

describe('ApprovalsProcessorService', () => {
  let axelarGmpApi: DeepMocked<AxelarGmpApi>;
  let redisHelper: DeepMocked<RedisHelper>;
  let walletSigner: string;
  let transactionsHelper: DeepMocked<TransactionsHelper>;
  let gatewayContract: DeepMocked<GatewayContract>;
  let messageApprovedRepository: DeepMocked<MessageApprovedRepository>;
  let gasServiceContract: DeepMocked<GasServiceContract>;
  let hiroApiHelper: DeepMocked<HiroApiHelper>;

  let service: ApprovalsProcessorService;

  beforeEach(async () => {
    axelarGmpApi = createMock();
    redisHelper = createMock();
    transactionsHelper = createMock();
    gatewayContract = createMock();
    messageApprovedRepository = createMock();
    gasServiceContract = createMock();
    hiroApiHelper = createMock();
    walletSigner = 'mocked-wallet-signer';

    const moduleRef = await Test.createTestingModule({
      providers: [ApprovalsProcessorService],
    })
      .useMocker((token) => {
        if (token === AxelarGmpApi) {
          return axelarGmpApi;
        }

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

        if (token === MessageApprovedRepository) {
          return messageApprovedRepository;
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

    redisHelper.get.mockImplementation(() => {
      return Promise.resolve(undefined);
    });

    service = moduleRef.get(ApprovalsProcessorService);
  });

  describe('handleNewTasks', () => {
    it('Should handle get tasks error', async () => {
      axelarGmpApi.getTasks.mockRejectedValueOnce(new Error('Network error'));
      await service.handleNewTasksRaw();
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(1);
    });

    it('Should handle get tasks as long as there are tasks', async () => {
      // @ts-ignore
      axelarGmpApi.getTasks.mockImplementation((_, lastTaskUUID) => {
        let tasks: TaskItem[] = [];
        if (lastTaskUUID !== 'lastUUID1') {
          tasks = [
            {
              type: 'REFUND',
              task: {
                refundRecipientAddress: '',
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
              } as RefundTask,
              id: 'lastUUID1',
              timestamp: '1234',
            },
          ];
        }
        return Promise.resolve({
          data: {
            tasks,
          },
        });
      });
      hiroApiHelper.getAccountBalance.mockResolvedValue({
        stx: {
          balance: '100',
        },
      } as any);
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gasServiceContract.refund.mockResolvedValueOnce(transaction);
      transactionsHelper.sendTransaction.mockResolvedValue('txHash');
      await service.handleNewTasksRaw();
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', undefined);
      expect(redisHelper.set).toHaveBeenCalledWith(
        CacheInfo.LastTaskUUID().key,
        'lastUUID1',
        CacheInfo.LastTaskUUID().ttl,
      );
    });

    it('Should handle gateway tx task', async () => {
      axelarGmpApi.getTasks.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          data: {
            tasks: [
              {
                type: 'GATEWAY_TX',
                task: {
                  executeData: mockExternalData,
                } as GatewayTransactionTask,
                id: 'UUID',
                timestamp: '1234',
              },
            ],
          },
        }),
      );
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));
      transactionsHelper.getTransactionGas.mockReturnValueOnce(Promise.resolve(100_000_000n));

      await service.handleNewTasksRaw();

      expect(redisHelper.get).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', undefined);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', 'UUID');
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledTimes(1);
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledWith(
        'approveMessages@61726731@61726732',
        walletSigner,
      );
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 0);
      expect(transaction.setFee).toHaveBeenCalledTimes(1);
      expect(transaction.setFee).toHaveBeenCalledWith(100_000_000n);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledWith(transaction);
      expect(redisHelper.set).toHaveBeenCalledTimes(2);
      expect(redisHelper.set).toHaveBeenCalledWith(
        CacheInfo.PendingTransaction('txHash').key,
        {
          txHash: 'txHash',
          externalData: mockExternalData,
          retry: 1,
        },
        CacheInfo.PendingTransaction('txHash').ttl,
      );
      expect(redisHelper.set).toHaveBeenCalledWith(CacheInfo.LastTaskUUID().key, 'UUID', CacheInfo.LastTaskUUID().ttl);
    });

    it('Should handle execute task', async () => {
      axelarGmpApi.getTasks.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          data: {
            tasks: [
              {
                type: 'EXECUTE',
                task: {
                  payload: Buffer.from('0123', 'hex').toString('base64'),
                  availableGasBalance: {
                    amount: '0',
                  },
                  message: {
                    messageID: 'messageId',
                    destinationAddress: 'destinationAddress',
                    sourceAddress: 'sourceAddress',
                    sourceChain: 'ethereum',
                    payloadHash: Buffer.from('0234', 'hex').toString('base64'),
                  },
                } as ExecuteTask,
                id: 'UUID',
                timestamp: '1234',
              },
            ],
          },
        }),
      );
      await service.handleNewTasksRaw();
      expect(messageApprovedRepository.create).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.create).toHaveBeenCalledWith({
        sourceChain: 'ethereum',
        messageId: 'messageId',
        status: MessageApprovedStatus.PENDING,
        sourceAddress: 'sourceAddress',
        contractAddress: 'destinationAddress',
        payloadHash: '0234',
        payload: Buffer.from('0123', 'hex'),
        retry: 0,
        taskItemId: 'UUID',
      });
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('Should handle execute task duplicate in database', async () => {
      axelarGmpApi.getTasks.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          data: {
            tasks: [
              {
                type: 'EXECUTE',
                task: {
                  payload: '0123',
                  availableGasBalance: {
                    amount: '0',
                  },
                  message: {
                    messageID: 'messageId',
                    destinationAddress: 'destinationAddress',
                    sourceAddress: 'sourceAddress',
                    sourceChain: 'ethereum',
                    payloadHash: '0234',
                  },
                } as ExecuteTask,
                id: 'UUID',
                timestamp: '1234',
              },
            ],
          },
        }),
      );
      messageApprovedRepository.create.mockReturnValueOnce(Promise.resolve(null));
      await service.handleNewTasksRaw();
      expect(messageApprovedRepository.create).toHaveBeenCalledTimes(1);
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('Should not save last task uuid if error', async () => {
      axelarGmpApi.getTasks.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          data: {
            tasks: [
              {
                type: 'GATEWAY_TX',
                task: {
                  executeData: mockExternalData,
                } as GatewayTransactionTask,
                id: 'UUID',
                timestamp: '1234',
              },
            ],
          },
        }),
      );
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.getTransactionGas.mockRejectedValueOnce(new Error('Network error'));

      await service.handleNewTasksRaw();

      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 0);
      expect(redisHelper.set).not.toHaveBeenCalled();
      // Mock lastUUID
      redisHelper.get.mockImplementation(() => {
        return Promise.resolve('lastUUID1');
      });
      // Will start processing tasks from lastUUID1
      await service.handleNewTasksRaw();
      expect(redisHelper.get).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', 'lastUUID1');
    });

    it('Should handle verify task', async () => {
      axelarGmpApi.getTasks.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          data: {
            tasks: [
              {
                type: 'VERIFY',
                task: {
                  message: {
                    messageID: '',
                    payloadHash: '',
                    sourceChain: '',
                    sourceAddress: '',
                    destinationAddress: '',
                  },
                  payload: mockVerifyData,
                } as VerifyTask,
                id: 'UUID',
                timestamp: '1234',
              },
            ],
          },
        }),
      );
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));

      await service.handleNewTasksRaw();

      expect(redisHelper.get).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', undefined);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', 'UUID');
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledTimes(1);
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledWith(
        'rotateSigners@1234@4321',
        walletSigner,
      );
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledWith(transaction);
      expect(redisHelper.set).toHaveBeenCalledTimes(2);
      expect(redisHelper.set).toHaveBeenCalledWith(
        CacheInfo.PendingTransaction('txHash').key,
        {
          txHash: 'txHash',
          externalData: mockVerifyData,
          retry: 1,
        },
        CacheInfo.PendingTransaction('txHash').ttl,
      );
      expect(redisHelper.set).toHaveBeenCalledWith(CacheInfo.LastTaskUUID().key, 'UUID', CacheInfo.LastTaskUUID().ttl);
    });
  });

  describe('handlePendingTransactions', () => {
    it('Should handle undefined', async () => {
      const key = CacheInfo.PendingTransaction('txHashUndefined').key;

      redisHelper.scan.mockReturnValueOnce(Promise.resolve([key]));
      redisHelper.get.mockReturnValueOnce(Promise.resolve(undefined));

      await service.handlePendingTransactionsRaw();

      expect(redisHelper.scan).toHaveBeenCalledTimes(1);
      expect(redisHelper.get).toHaveBeenCalledTimes(1);
      expect(redisHelper.get).toHaveBeenCalledWith(key);
      expect(redisHelper.delete).toHaveBeenCalledTimes(1);
      expect(redisHelper.delete).toHaveBeenCalledWith(key);
      expect(transactionsHelper.awaitSuccess).not.toHaveBeenCalled();
    });

    it('Should handle success', async () => {
      const key = CacheInfo.PendingTransaction('txHashComplete').key;

      redisHelper.scan.mockReturnValueOnce(Promise.resolve([key]));
      redisHelper.get.mockReturnValueOnce(
        Promise.resolve({
          txHash: 'txHashComplete',
          executeData: mockExternalData,
          retry: 1,
        }),
      );
      transactionsHelper.awaitSuccess.mockReturnValueOnce(Promise.resolve(true));

      await service.handlePendingTransactionsRaw();

      expect(redisHelper.scan).toHaveBeenCalledTimes(1);
      expect(redisHelper.get).toHaveBeenCalledTimes(1);
      expect(redisHelper.get).toHaveBeenCalledWith(key);
      expect(redisHelper.delete).toHaveBeenCalledTimes(1);
      expect(redisHelper.delete).toHaveBeenCalledWith(key);
      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledWith('txHashComplete');
      expect(transactionsHelper.getTransactionGas).not.toHaveBeenCalled();
    });

    it('Should handle retry', async () => {
      const key = CacheInfo.PendingTransaction('txHashComplete').key;
      const externalData = mockExternalData;

      redisHelper.scan.mockReturnValueOnce(Promise.resolve([key]));
      redisHelper.get.mockReturnValueOnce(
        Promise.resolve({
          txHash: 'txHashComplete',
          externalData,
          retry: 1,
        }),
      );
      transactionsHelper.awaitSuccess.mockReturnValueOnce(Promise.resolve(false));

      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);

      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));
      transactionsHelper.getTransactionGas.mockReturnValueOnce(Promise.resolve(100_000_000n));

      await service.handlePendingTransactionsRaw();

      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledWith('txHashComplete');

      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledTimes(1);
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledWith(
        'approveMessages@61726731@61726732',
        walletSigner,
      );
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 1);
      expect(transaction.setFee).toHaveBeenCalledTimes(1);
      expect(transaction.setFee).toHaveBeenCalledWith(100_000_000n);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledWith(transaction);

      expect(redisHelper.set).toHaveBeenCalledTimes(1);
      expect(redisHelper.set).toHaveBeenCalledWith(
        CacheInfo.PendingTransaction('txHash').key,
        {
          txHash: 'txHash',
          externalData,
          retry: 2,
        },
        CacheInfo.PendingTransaction('txHash').ttl,
      );
    });

    it('Should not handle final retry', async () => {
      const key = CacheInfo.PendingTransaction('txHashComplete').key;
      const executeData = Uint8Array.of(1, 2, 3, 4);

      redisHelper.scan.mockReturnValueOnce(Promise.resolve([key]));
      redisHelper.get.mockReturnValueOnce(
        Promise.resolve({
          txHash: 'txHashComplete',
          executeData,
          retry: 3,
        }),
      );
      transactionsHelper.awaitSuccess.mockReturnValueOnce(Promise.resolve(false));

      await service.handlePendingTransactionsRaw();

      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledWith('txHashComplete');
      expect(transactionsHelper.getTransactionGas).not.toHaveBeenCalled();
    });

    it('Should handle retry error', async () => {
      const key = CacheInfo.PendingTransaction('txHashComplete').key;
      const externalData = mockExternalData;

      redisHelper.scan.mockReturnValueOnce(Promise.resolve([key]));
      redisHelper.get.mockReturnValueOnce(
        Promise.resolve({
          txHash: 'txHashComplete',
          externalData,
          retry: 1,
        }),
      );
      transactionsHelper.awaitSuccess.mockReturnValueOnce(Promise.resolve(false));

      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.getTransactionGas.mockRejectedValueOnce(new Error('Network error'));

      await service.handlePendingTransactionsRaw();

      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledWith('txHashComplete');

      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 1);

      expect(redisHelper.set).toHaveBeenCalledTimes(1);
      expect(redisHelper.set).toHaveBeenCalledWith(
        CacheInfo.PendingTransaction('txHashComplete').key,
        {
          txHash: 'txHashComplete',
          externalData,
          retry: 1,
        },
        CacheInfo.PendingTransaction('txHashComplete').ttl,
      );
    });
  });

  describe('processRefundTask', () => {
    function assertRefundSuccess(senderKey: string, transaction: StacksTransaction, token: string) {
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', undefined);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', 'UUID');

      expect(gasServiceContract.refund).toHaveBeenCalledTimes(1);
      expect(gasServiceContract.refund).toHaveBeenCalledWith(
        senderKey,
        'messageTxHash',
        '1',
        'recipientAddress',
        '1000',
      );
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledWith(transaction);
    }

    it('Should handle process refund task STX success', async () => {
      axelarGmpApi.getTasks.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          data: {
            tasks: [
              {
                type: 'REFUND',
                task: {
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
                } as RefundTask,
                id: 'UUID',
                timestamp: '1234',
              },
            ],
          },
        }),
      );

      hiroApiHelper.getAccountBalance.mockResolvedValue({
        stx: {
          balance: '10000',
        },
      } as any);

      const transaction: DeepMocked<StacksTransaction> = createMock();
      gasServiceContract.refund.mockResolvedValueOnce(transaction);

      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));

      await service.handleNewTasksRaw();

      expect(hiroApiHelper.getAccountBalance).toHaveBeenCalledTimes(1);

      assertRefundSuccess(walletSigner, transaction, 'STX');
    });

    it('Should handle process refund task TOKEN success', async () => {
      axelarGmpApi.getTasks.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          data: {
            tasks: [
              {
                type: 'REFUND',
                task: {
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
                } as RefundTask,
                id: 'UUID',
                timestamp: '1234',
              },
            ],
          },
        }),
      );

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

      await service.handleNewTasksRaw();

      expect(hiroApiHelper.getAccountBalance).toHaveBeenCalledTimes(1);

      assertRefundSuccess(walletSigner, transaction, 'TOKEN-123456');
    });

    it('Should handle process refund balance too low', async () => {
      axelarGmpApi.getTasks.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          data: {
            tasks: [
              {
                type: 'REFUND',
                task: {
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
                } as RefundTask,
                id: 'UUID',
                timestamp: '1234',
              },
            ],
          },
        }),
      );

      hiroApiHelper.getAccountBalance.mockResolvedValue({
        stx: {
          balance: '999',
        },
      } as any);

      const transaction: DeepMocked<StacksTransaction> = createMock();
      gasServiceContract.refund.mockResolvedValueOnce(transaction);

      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));

      await service.handleNewTasksRaw();

      expect(hiroApiHelper.getAccountBalance).toHaveBeenCalledTimes(1);

      expect(redisHelper.set).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);

      expect(gasServiceContract.refund).not.toHaveBeenCalled();
      expect(transactionsHelper.sendTransaction).not.toHaveBeenCalled();
    });

    it('Should handle process refund task TOKEN exception', async () => {
      axelarGmpApi.getTasks.mockReturnValueOnce(
        // @ts-ignore
        Promise.resolve({
          data: {
            tasks: [
              {
                type: 'REFUND',
                task: {
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
                } as RefundTask,
                id: 'UUID',
                timestamp: '1234',
              },
            ],
          },
        }),
      );

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

      await service.handleNewTasksRaw();

      expect(hiroApiHelper.getAccountBalance).toHaveBeenCalledTimes(1);

      expect(redisHelper.set).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);

      expect(gasServiceContract.refund).not.toHaveBeenCalled();
      expect(transactionsHelper.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
