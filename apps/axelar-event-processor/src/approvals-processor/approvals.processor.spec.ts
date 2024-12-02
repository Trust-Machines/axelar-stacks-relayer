import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { MessageApprovedStatus } from '@prisma/client';
import { ApiConfigService, CacheInfo, GasServiceContract, TransactionsHelper } from '@stacks-monorepo/common';
import { AxelarGmpApi } from '@stacks-monorepo/common/api/axelar.gmp.api';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { GatewayContract } from '@stacks-monorepo/common/contracts/gateway.contract';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { awaitSuccess } from '@stacks-monorepo/common/utils/await-success';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksNetwork } from '@stacks/network';
import { StacksTransaction } from '@stacks/transactions';
import { ApprovalsProcessorService, AXELAR_CHAIN } from './approvals.processor.service';
import { PendingConstructProof } from './entities/pending-construct-proof';
import GatewayTransactionTask = Components.Schemas.GatewayTransactionTask;
import TaskItem = Components.Schemas.TaskItem;
import RefundTask = Components.Schemas.RefundTask;
import ExecuteTask = Components.Schemas.ExecuteTask;

const mockExternalData = Buffer.from(
  '0c00000003046461746102000001210b000000010c0000000510636f6e74726163742d61646472657373061a2ffa5b05761d84adca1ad9215e7a7efdeddb10fe0b68656c6c6f2d776f726c640a6d6573736167652d69640d000000443078363432383430626531303961386530326564316637663635626137633165643539396133383137393666386233343032313164363435313161663761386131372d300c7061796c6f61642d686173680200000020af6b8f9d6a366d59d2851d7fd30a10c430dc949470ad50a13f5655b945f9c8830e736f757263652d616464726573730d0000002a3078634534313033383637434334426662323338324536443042374638386536453346384435363344360c736f757263652d636861696e0d0000000e6176616c616e6368652d66756a690866756e6374696f6e0d00000010617070726f76652d6d657373616765730570726f6f6602000001df0c000000020a7369676e6174757265730b0000000202000000419f1be5d20bb51f35a9b78e0c33673e2f7137b1227ff03f469adc3e4169f5be020d3d437d5188642086ff6ac44ff6fdcfdb293dc43f30cf13b94cd0b1fe5dcd9b010200000041cbc6f69b0d7a14e026ebfe6d7e97870ff1ff1adb961161492d7d60843ea32ae3576626ef6062c9e1779f95dbf956ece0793b35270545a35a4fea5fe24f60a4fe01077369676e6572730c00000003056e6f6e63650200000020000000000000000000000000000000000000000000000000000000000038d32c077369676e6572730b000000030c00000002067369676e65720200000021026e4a6fc3a6988c4cd7d3bc02e07bac8b72a9f5342d92f42161e7b6e57dd47e180677656967687401000000000000000000000000000000010c00000002067369676e6572020000002102d19c406d763c98d98554c980ae03543b936aad0c3f1289a367a0c2aafb71e8c10677656967687401000000000000000000000000000000010c00000002067369676e6572020000002103ea531f69879b3b15b6e3fe262250d5ceca6217e03e4def6919d4bdce3a7ec389067765696768740100000000000000000000000000000001097468726573686f6c640100000000000000000000000000000002==',
  'hex',
).toString('base64');
const mockDataDecoded = {
  data: '0x0b000000010c0000000510636f6e74726163742d61646472657373061a2ffa5b05761d84adca1ad9215e7a7efdeddb10fe0b68656c6c6f2d776f726c640a6d6573736167652d69640d000000443078363432383430626531303961386530326564316637663635626137633165643539396133383137393666386233343032313164363435313161663761386131372d300c7061796c6f61642d686173680200000020af6b8f9d6a366d59d2851d7fd30a10c430dc949470ad50a13f5655b945f9c8830e736f757263652d616464726573730d0000002a3078634534313033383637434334426662323338324536443042374638386536453346384435363344360c736f757263652d636861696e0d0000000e6176616c616e6368652d66756a69',
  function: 'approve-messages',
  proof:
    '0x0c000000020a7369676e6174757265730b0000000202000000419f1be5d20bb51f35a9b78e0c33673e2f7137b1227ff03f469adc3e4169f5be020d3d437d5188642086ff6ac44ff6fdcfdb293dc43f30cf13b94cd0b1fe5dcd9b010200000041cbc6f69b0d7a14e026ebfe6d7e97870ff1ff1adb961161492d7d60843ea32ae3576626ef6062c9e1779f95dbf956ece0793b35270545a35a4fea5fe24f60a4fe01077369676e6572730c00000003056e6f6e63650200000020000000000000000000000000000000000000000000000000000000000038d32c077369676e6572730b000000030c00000002067369676e65720200000021026e4a6fc3a6988c4cd7d3bc02e07bac8b72a9f5342d92f42161e7b6e57dd47e180677656967687401000000000000000000000000000000010c00000002067369676e6572020000002102d19c406d763c98d98554c980ae03543b936aad0c3f1289a367a0c2aafb71e8c10677656967687401000000000000000000000000000000010c00000002067369676e6572020000002103ea531f69879b3b15b6e3fe262250d5ceca6217e03e4def6919d4bdce3a7ec389067765696768740100000000000000000000000000000001097468726573686f6c640100000000000000000000000000000002',
};

jest.mock('@stacks-monorepo/common/utils/await-success');

const AXELAR_ITS_CONTRACT = 'axelarContract';

describe('ApprovalsProcessorService', () => {
  let axelarGmpApi: DeepMocked<AxelarGmpApi>;
  let redisHelper: DeepMocked<RedisHelper>;
  let walletSigner: string;
  let transactionsHelper: DeepMocked<TransactionsHelper>;
  let gatewayContract: DeepMocked<GatewayContract>;
  let messageApprovedRepository: DeepMocked<MessageApprovedRepository>;
  let gasServiceContract: DeepMocked<GasServiceContract>;
  let hiroApiHelper: DeepMocked<HiroApiHelper>;
  let apiConfigService: DeepMocked<ApiConfigService>;
  let mockNetwork: DeepMocked<StacksNetwork>;

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
    apiConfigService = createMock();

    apiConfigService.getAxelarContractIts.mockReturnValue(AXELAR_ITS_CONTRACT);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprovalsProcessorService,
        {
          provide: ProviderKeys.STACKS_NETWORK,
          useValue: mockNetwork,
        },
      ],
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

        if (token === ApiConfigService) {
          return apiConfigService;
        }

        return null;
      })
      .compile();

    redisHelper.get.mockImplementation(() => {
      return Promise.resolve(undefined);
    });

    gasServiceContract.getProxyContractAddress.mockReturnValue('contract_name.contract_address');
    gasServiceContract.getGasImpl.mockResolvedValue('contract_impl_address.contract_impl_name');

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
              chain: '',
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
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
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
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
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
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledTimes(2);
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledWith(mockDataDecoded, walletSigner);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 0, mockNetwork);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalled();
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
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
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
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
            },
          }),
        );
      await service.handleNewTasksRaw();
      expect(messageApprovedRepository.createOrUpdate).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.createOrUpdate).toHaveBeenCalledWith({
        sourceChain: 'ethereum',
        messageId: 'messageId',
        status: MessageApprovedStatus.PENDING,
        sourceAddress: 'sourceAddress',
        contractAddress: 'destinationAddress',
        payloadHash: '0234',
        payload: Buffer.from('0123', 'hex'),
        retry: 0,
        taskItemId: 'UUID',
        availableGasBalance: '0',
      });
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('Should handle execute task invalid gas token', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [
                {
                  type: 'EXECUTE',
                  task: {
                    payload: Buffer.from('0123', 'hex').toString('base64'),
                    availableGasBalance: {
                      tokenID: 'other',
                      amount: '100',
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
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
            },
          }),
        );

      await service.handleNewTasksRaw();

      expect(messageApprovedRepository.createOrUpdate).toHaveBeenCalledTimes(1);
      expect(messageApprovedRepository.createOrUpdate).toHaveBeenCalledWith({
        sourceChain: 'ethereum',
        messageId: 'messageId',
        status: MessageApprovedStatus.PENDING,
        sourceAddress: 'sourceAddress',
        contractAddress: 'destinationAddress',
        payloadHash: '0234',
        payload: Buffer.from('0123', 'hex'),
        retry: 0,
        taskItemId: 'UUID',
        availableGasBalance: '0',
      });
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('Should not save last task uuid if error', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
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
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
            },
          }),
        );
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.getTransactionGas.mockRejectedValueOnce(new Error('Network error'));
      await service.handleNewTasksRaw();
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 0, mockNetwork);
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
      transactionsHelper.awaitSuccess.mockReturnValueOnce(
        Promise.resolve({
          success: true,
          transaction: null,
        }),
      );
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
      transactionsHelper.awaitSuccess.mockReturnValueOnce(
        Promise.resolve({
          success: false,
          transaction: null,
        }),
      );
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.sendTransaction.mockReturnValueOnce(Promise.resolve('txHash'));
      transactionsHelper.getTransactionGas.mockReturnValueOnce(Promise.resolve(100_000_000n));
      await service.handlePendingTransactionsRaw();
      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledWith('txHashComplete');
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledTimes(2);
      expect(gatewayContract.buildTransactionExternalFunction).toHaveBeenCalledWith(mockDataDecoded, walletSigner);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 1, mockNetwork);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.sendTransaction).toHaveBeenCalled();
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
      transactionsHelper.awaitSuccess.mockReturnValueOnce(
        Promise.resolve(
          Promise.resolve({
            success: false,
            transaction: null,
          }),
        ),
      );
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
      transactionsHelper.awaitSuccess.mockReturnValueOnce(
        Promise.resolve({
          success: false,
          transaction: null,
        }),
      );
      const transaction: DeepMocked<StacksTransaction> = createMock();
      gatewayContract.buildTransactionExternalFunction.mockResolvedValueOnce(transaction);
      transactionsHelper.getTransactionGas.mockRejectedValueOnce(new Error('Network error'));
      await service.handlePendingTransactionsRaw();
      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.awaitSuccess).toHaveBeenCalledWith('txHashComplete');
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledTimes(1);
      expect(transactionsHelper.getTransactionGas).toHaveBeenCalledWith(transaction, 1, mockNetwork);
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
    function assertRefundSuccess(senderKey: string, transaction: StacksTransaction) {
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', undefined);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', 'UUID');

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
    }

    it('Should handle process refund task STX success', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
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
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
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

      assertRefundSuccess(walletSigner, transaction);
    });

    it('Should handle process refund task TOKEN success', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
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
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
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

      assertRefundSuccess(walletSigner, transaction);
    });

    it('Should handle process refund balance too low', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
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
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
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
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
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
        )
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [],
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

  describe('handleConstructProof', () => {
    it('should add a single entry in Redis for construct_proof_with_payload', async () => {
      const response = {
        message: {
          sourceChain: AXELAR_CHAIN,
          messageID: 'msg1',
          sourceAddress: AXELAR_ITS_CONTRACT,
          destinationAddress: 'someDestination',
          payloadHash: 'payloadHash1',
        },
        payload: 'payloadData',
      };

      await service.processConstructProofTask(response);

      expect(redisHelper.set).toHaveBeenCalledWith(
        `pendingConstructProof:${AXELAR_CHAIN}_msg1`,
        expect.objectContaining({
          request: {
            construct_proof_with_payload: {
              message_id: {
                source_chain: response.message.sourceChain,
                message_id: response.message.messageID,
              },
              payload: response.payload,
            },
          },
          retry: 0,
        }),
        600,
      );
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('should add a single entry in Redis for construct_proof', async () => {
      const response = {
        message: {
          sourceChain: 'otherChain',
          messageID: 'msg2',
          sourceAddress: 'randomAddress',
          destinationAddress: 'anotherDestination',
          payloadHash: 'payloadHash2',
        },
        payload: 'payloadData',
      };

      await service.processConstructProofTask(response);

      expect(redisHelper.set).toHaveBeenCalledWith(
        'pendingConstructProof:otherChain_msg2',
        expect.objectContaining({
          request: {
            construct_proof: [
              {
                source_chain: response.message.sourceChain,
                message_id: response.message.messageID,
              },
            ],
          },
          retry: 0,
        }),
        600,
      );

      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('should process and remove construct proof if broadcast status is SUCCESS', async () => {
      const key = CacheInfo.PendingConstructProof('axelar_msg1').key;
      const pendingProof: PendingConstructProof = {
        request: { construct_proof: [{ source_chain: 'axelar', message_id: 'msg1' }] },
        retry: 0,
        broadcastID: 'broadcastID1',
      };

      jest.mocked(awaitSuccess).mockResolvedValue({ success: true, result: 'SUCCESS' });

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);

      await service.handlePendingConstructProofRaw();

      expect(redisHelper.delete).toHaveBeenCalledWith(key);
      expect(redisHelper.delete).toHaveBeenCalledTimes(1);
    });

    it('should retry construct proof broadcast if status is not SUCCESS', async () => {
      const id = 'axelar_msg1';
      const key = CacheInfo.PendingConstructProof(id).key;
      const pendingProof: PendingConstructProof = {
        request: { construct_proof: [{ source_chain: 'axelar', message_id: 'msg2' }] },
        retry: 0,
        broadcastID: 'broadcastID2',
      };

      jest.mocked(awaitSuccess).mockResolvedValue({ success: false, result: 'RECEIVED' });

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);

      await service.handlePendingConstructProofRaw();

      expect(redisHelper.set).toHaveBeenCalledWith(
        key,
        { ...pendingProof, retry: 1 },
        CacheInfo.PendingConstructProof(id).ttl,
      );
      expect(redisHelper.set).toHaveBeenCalledTimes(1);
    });

    it('should handle new broadcast for construct proof if no broadcastID is set', async () => {
      const id = 'axelar_msg3';
      const key = CacheInfo.PendingConstructProof(id).key;
      const pendingProof: PendingConstructProof = {
        request: { construct_proof: [{ source_chain: 'axelar', message_id: 'msg3' }] },
        retry: 0,
      };

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);
      axelarGmpApi.broadcastMsgExecuteContract.mockResolvedValue('newBroadcastID');

      await service.handlePendingConstructProofRaw();

      expect(axelarGmpApi.broadcastMsgExecuteContract).toHaveBeenCalledTimes(1);
      expect(redisHelper.set).toHaveBeenCalledWith(
        key,
        { ...pendingProof, broadcastID: 'newBroadcastID' },
        CacheInfo.PendingConstructProof(id).ttl,
      );
    });

    it('should delete construct proof if maximum retries are reached', async () => {
      const id = 'axelar_msg4';
      const key = CacheInfo.PendingConstructProof(id).key;
      const pendingProof: PendingConstructProof = {
        request: { construct_proof: [{ source_chain: 'axelar', message_id: 'msg4' }] },
        retry: 3,
      };

      redisHelper.scan.mockResolvedValue([key]);
      redisHelper.get.mockResolvedValue(pendingProof);

      await service.handlePendingConstructProofRaw();

      expect(redisHelper.delete).toHaveBeenCalledWith(key);
      expect(redisHelper.delete).toHaveBeenCalledTimes(1);
    });
  });
});
