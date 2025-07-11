import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MessageApprovedStatus, StacksTransactionStatus, StacksTransactionType } from '@prisma/client';
import { Locker } from '@stacks-monorepo/common';
import { AxelarGmpApi } from '@stacks-monorepo/common/api/axelar.gmp.api';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { AxiosError } from 'axios';
import {
  LAST_PROCESSED_DATA_TYPE,
  LastProcessedDataRepository,
} from '@stacks-monorepo/common/database/repository/last-processed-data.repository';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { StacksTransactionRepository } from '@stacks-monorepo/common/database/repository/stacks-transaction.repository';
import TaskItem = Components.Schemas.TaskItem;
import GatewayTransactionTask = Components.Schemas.GatewayTransactionTask;
import ExecuteTask = Components.Schemas.ExecuteTask;
import RefundTask = Components.Schemas.RefundTask;

@Injectable()
export class ApprovalsProcessorService {
  private readonly logger: Logger;

  constructor(
    private readonly axelarGmpApi: AxelarGmpApi,
    private readonly messageApprovedRepository: MessageApprovedRepository,
    private readonly lastProcessedDataRepository: LastProcessedDataRepository,
    private readonly slackApi: SlackApi,
    private readonly stacksTransactionRepository: StacksTransactionRepository,
  ) {
    this.logger = new Logger(ApprovalsProcessorService.name);
  }

  @Cron('0/10 * * * * *')
  async handleNewTasks() {
    await Locker.lock('handleNewTasks', this.handleNewTasksRaw.bind(this));
  }

  async handleNewTasksRaw() {
    let lastTaskUUID = await this.lastProcessedDataRepository.get(LAST_PROCESSED_DATA_TYPE.LAST_TASK_ID);

    this.logger.debug(`Trying to process tasks for stacks starting from id: ${lastTaskUUID}`);

    // Process as many tasks as possible until no tasks are left or there is an error
    let tasks: TaskItem[] = [];
    do {
      try {
        const response = await this.axelarGmpApi.getTasks(CONSTANTS.SOURCE_CHAIN_NAME, lastTaskUUID);

        if (response.data.tasks.length === 0) {
          return;
        }

        tasks = response.data.tasks;

        this.logger.debug(`Starting processing of ${tasks.length} tasks`);

        for (const task of tasks) {
          try {
            await this.processTask(task);

            lastTaskUUID = task.id;

            await this.lastProcessedDataRepository.update(LAST_PROCESSED_DATA_TYPE.LAST_TASK_ID, lastTaskUUID);
          } catch (e) {
            this.logger.error(`Could not process task ${task.id} ${task.type}. Will be retried`, task, e);
            await this.slackApi.sendError(
              'Task processing error',
              `Could not process task ${task.id}, ${task.type}. Will be retried`,
            );

            // Stop processing in case of an error and retry from the same task
            return;
          }
        }

        this.logger.log(`Successfully processed ${tasks.length} task, last task UUID ${lastTaskUUID}`);
      } catch (e) {
        this.logger.error(`Error retrieving tasks... Last task UUID ${lastTaskUUID}`, e);
        await this.slackApi.sendError(
          'Task processing error',
          `Error retrieving tasks... Last task UUID retrieved: ${lastTaskUUID}`,
        );

        if (e instanceof AxiosError) {
          this.logger.error(e.response?.data);
        }

        return;
      }
    } while (tasks.length > 0);
  }

  private async processTask(task: TaskItem) {
    if (task.type === 'GATEWAY_TX') {
      const response = task.task as GatewayTransactionTask;

      await this.processGatewayTxTask(response, task.id);

      return;
    }

    if (task.type === 'EXECUTE') {
      const response = task.task as ExecuteTask;

      await this.processExecuteTask(response, task.id);

      return;
    }

    if (task.type === 'REFUND') {
      const response = task.task as RefundTask;

      await this.processRefundTask(response, task.id);

      return;
    }

    this.logger.warn(`Received unknown task of type ${task.type}, id ${task.id}`, task);
    await this.slackApi.sendWarn(
      'Axelar event processor unknown task',
      `Received unknown task of type ${task.type}, id ${task.id}`,
    );
  }

  private async processGatewayTxTask(response: GatewayTransactionTask, taskItemId: string) {
    await this.stacksTransactionRepository.createOrUpdate({
      type: StacksTransactionType.GATEWAY,
      status: StacksTransactionStatus.PENDING,
      extraData: response as any,
      taskItemId,
      retry: 0,
    });

    this.logger.debug(`Processed GATEWAY_TX task ${taskItemId}`);
  }

  private async processExecuteTask(response: ExecuteTask, taskItemId: string) {
    await this.messageApprovedRepository.createOrUpdate({
      sourceChain: response.message.sourceChain,
      messageId: response.message.messageID,
      status: MessageApprovedStatus.PENDING,
      sourceAddress: response.message.sourceAddress,
      contractAddress: response.message.destinationAddress,
      payloadHash: Buffer.from(response.message.payloadHash, 'base64').toString('hex'),
      payload: Buffer.from(response.payload, 'base64'),
      retry: 0,
      taskItemId,
      // Only support native token for gas
      availableGasBalance: !response.availableGasBalance.tokenID ? response.availableGasBalance.amount : '0',
    });

    this.logger.debug(
      `Processed EXECUTE task ${taskItemId}, message from ${response.message.sourceChain} with messageId ${response.message.messageID}`,
    );
  }

  private async processRefundTask(response: RefundTask, taskItemId: string) {
    await this.stacksTransactionRepository.createOrUpdate({
      type: StacksTransactionType.REFUND,
      status: StacksTransactionStatus.PENDING,
      extraData: response as any,
      taskItemId,
      retry: 0,
    });

    this.logger.debug(`Processed REFUND task ${taskItemId}`);
  }
}
