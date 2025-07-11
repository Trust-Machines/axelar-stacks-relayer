import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { MessageApprovedStatus, StacksTransactionStatus, StacksTransactionType } from '@prisma/client';
import { ApiConfigService } from '@stacks-monorepo/common';
import { AxelarGmpApi } from '@stacks-monorepo/common/api/axelar.gmp.api';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { RedisHelper } from '@stacks-monorepo/common/helpers/redis.helper';
import { ApprovalsProcessorService } from './approvals.processor.service';
import { LastProcessedDataRepository } from '@stacks-monorepo/common/database/repository/last-processed-data.repository';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { StacksTransactionRepository } from '@stacks-monorepo/common/database/repository/stacks-transaction.repository';
import GatewayTransactionTask = Components.Schemas.GatewayTransactionTask;
import TaskItem = Components.Schemas.TaskItem;
import RefundTask = Components.Schemas.RefundTask;
import ExecuteTask = Components.Schemas.ExecuteTask;

describe('ApprovalsProcessorService', () => {
  let axelarGmpApi: DeepMocked<AxelarGmpApi>;
  let redisHelper: DeepMocked<RedisHelper>;
  let messageApprovedRepository: DeepMocked<MessageApprovedRepository>;
  let lastProcessedDataRepository: DeepMocked<LastProcessedDataRepository>;
  let apiConfigService: DeepMocked<ApiConfigService>;
  let slackApi: DeepMocked<SlackApi>;
  let stacksTransactionRepository: DeepMocked<StacksTransactionRepository>;

  let service: ApprovalsProcessorService;

  beforeEach(async () => {
    axelarGmpApi = createMock();
    redisHelper = createMock();
    messageApprovedRepository = createMock();
    lastProcessedDataRepository = createMock();
    apiConfigService = createMock();
    slackApi = createMock();
    stacksTransactionRepository = createMock();

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

        if (token === MessageApprovedRepository) {
          return messageApprovedRepository;
        }

        if (token === LastProcessedDataRepository) {
          return lastProcessedDataRepository;
        }

        if (token === ApiConfigService) {
          return apiConfigService;
        }

        if (token === SlackApi) {
          return slackApi;
        }

        if (token === StacksTransactionRepository) {
          return stacksTransactionRepository;
        }

        return null;
      })
      .compile();

    lastProcessedDataRepository.get.mockImplementation(() => {
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

    it('Should handle GATEWAY_TX task', async () => {
      axelarGmpApi.getTasks
        .mockReturnValueOnce(
          // @ts-ignore
          Promise.resolve({
            data: {
              tasks: [
                {
                  type: 'GATEWAY_TX',
                  task: {
                    executeData: 'mockExecuteData',
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

      await service.handleNewTasksRaw();

      expect(lastProcessedDataRepository.get).toHaveBeenCalledTimes(1);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', undefined);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', 'UUID');
      expect(lastProcessedDataRepository.update).toHaveBeenCalledTimes(1);
      expect(stacksTransactionRepository.createOrUpdate).toHaveBeenCalledWith({
        type: StacksTransactionType.GATEWAY,
        status: StacksTransactionStatus.PENDING,
        extraData: {
          executeData: 'mockExecuteData',
        },
        taskItemId: 'UUID',
        retry: 0,
      });
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith('lastTaskUUID', 'UUID');
    });

    it('Should handle EXECUTE task', async () => {
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
      expect(lastProcessedDataRepository.update).toHaveBeenCalledTimes(1);
    });

    it('Should handle REFUND task', async () => {
      const refundTask: RefundTask = {
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
      };

      // @ts-ignore
      axelarGmpApi.getTasks.mockImplementation((_, lastTaskUUID) => {
        let tasks: TaskItem[] = [];
        if (lastTaskUUID !== 'lastUUID1') {
          tasks = [
            {
              type: 'REFUND',
              task: refundTask,
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

      await service.handleNewTasksRaw();

      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', undefined);
      expect(lastProcessedDataRepository.update).toHaveBeenCalledWith('lastTaskUUID', 'lastUUID1');
      expect(stacksTransactionRepository.createOrUpdate).toHaveBeenCalledTimes(1);
      expect(stacksTransactionRepository.createOrUpdate).toHaveBeenCalledWith({
        type: StacksTransactionType.REFUND,
        status: StacksTransactionStatus.PENDING,
        extraData: refundTask,
        taskItemId: 'lastUUID1',
        retry: 0,
      });
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
                    executeData: 'mockExecuteData',
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
      stacksTransactionRepository.createOrUpdate.mockRejectedValueOnce(new Error('Network error'));

      await service.handleNewTasksRaw();

      expect(lastProcessedDataRepository.update).not.toHaveBeenCalledTimes(1);
      // Mock lastUUID
      lastProcessedDataRepository.get.mockImplementation(() => {
        return Promise.resolve('lastUUID1');
      });
      // Will start processing tasks from lastUUID1
      await service.handleNewTasksRaw();
      expect(lastProcessedDataRepository.get).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledTimes(2);
      expect(axelarGmpApi.getTasks).toHaveBeenCalledWith('stacks', 'lastUUID1');
    });
  });
});
