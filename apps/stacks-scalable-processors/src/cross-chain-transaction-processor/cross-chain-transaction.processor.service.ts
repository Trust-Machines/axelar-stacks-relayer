import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiConfigService, AxelarGmpApi } from '@stacks-monorepo/common';
import { Components, MessageApprovedEvent } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { Locker, mapRawEventsToSmartContractEvents } from '@stacks-monorepo/common/utils';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { AxiosError } from 'axios';
import { GasServiceProcessor, GatewayProcessor, ItsProcessor } from './processors';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { CrossChainTransactionRepository } from '@stacks-monorepo/common/database/repository/cross-chain-transaction.repository';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CrossChainTransaction } from '@prisma/client';
import Event = Components.Schemas.Event;

@Injectable()
export class CrossChainTransactionProcessorService {
  private readonly contractGatewayStorage: string;
  private readonly contractGasServiceStorage: string;
  private readonly contractItsStorage: string;
  private readonly confirmationHeight: number;
  private readonly logger: Logger;

  constructor(
    private readonly gatewayProcessor: GatewayProcessor,
    private readonly gasServiceProcessor: GasServiceProcessor,
    private readonly itsProcessor: ItsProcessor,
    private readonly axelarGmpApi: AxelarGmpApi,
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly slackApi: SlackApi,
    private readonly crossChainTransactionRepository: CrossChainTransactionRepository,
    apiConfigService: ApiConfigService,
  ) {
    this.contractGatewayStorage = apiConfigService.getContractGatewayStorage();
    this.contractGasServiceStorage = apiConfigService.getContractGasServiceStorage();
    this.contractItsStorage = apiConfigService.getContractItsStorage();
    this.confirmationHeight = apiConfigService.getConfirmationHeight();
    this.logger = new Logger(CrossChainTransactionProcessorService.name);
  }

  // Runs after EventProcessor pollEvents cron has run
  @Cron('5/10 * * * * *')
  async processCrossChainTransactions() {
    await Locker.lock('processCrossChainTransactions', async () => {
      this.logger.debug('Running processCrossChainTransactions cron');

      const finalizedBurnBlockHeight = await this.getLatestFinalizedBurnBlockHeight();

      let txHashes;
      do {
        try {
          txHashes = await this.crossChainTransactionRepository.processPending(
            this.processCrossChainTransactionsRaw.bind(this),
            finalizedBurnBlockHeight,
          );
        } catch (e) {
          if (e instanceof PrismaClientKnownRequestError && e.code === 'P2028') {
            // Transaction timeout
            this.logger.warn('Cross chain transaction processing has timed out. Will be retried');
            await this.slackApi.sendWarn(
              `Cross chain transaction processing timeout`,
              `Processing has timed out. Will be retried`,
            );
          }
          throw e;
        }
      } while (txHashes.length > 0);
    });
  }

  private async getLatestFinalizedBurnBlockHeight() {
    const latestBlock = await this.hiroApiHelper.getLatestBlock();

    return latestBlock.burn_block_height + 1 - this.confirmationHeight; // Same as ampd logic
  }

  async processCrossChainTransactionsRaw(crossChainTransactions: CrossChainTransaction[]): Promise<{
    processedTxs: string[];
    updatedTxs: CrossChainTransaction[];
  }> {
    this.logger.log(`Found ${crossChainTransactions.length} CrossChainTransactions to query`);

    const processedTxs: string[] = [];
    const updatedTxs: CrossChainTransaction[] = [];
    for (const crossChainTx of crossChainTransactions) {
      try {
        const { transaction, fee } = await this.hiroApiHelper.getTransactionWithFee(crossChainTx.txHash);
        // Wait for transaction to be finished
        if ((transaction.tx_status as any) === 'pending') {
          continue;
        }

        if (transaction.tx_status === 'success') {
          const { eventsToSend, approvalEvents, hasContractCall } = await this.handleEvents(transaction, fee);

          // We need to wait for finality for Contract call event transactions
          // If transaction doesn't have burnBlockHeight set, update it in the database and don't process it yet
          // If finality is set, transaction is already final when it reaches this point
          if (hasContractCall && !crossChainTx.burnBlockHeight) {
            crossChainTx.burnBlockHeight = BigInt(transaction.burn_block_height);

            updatedTxs.push(crossChainTx);

            this.logger.log(`Waiting for finality for contract call event from tx ${crossChainTx.txHash}`);

            continue;
          }

          await this.sendEvents(eventsToSend, approvalEvents, transaction, fee);
        }

        // Mark transaction as processed, will be deleted from database
        processedTxs.push(crossChainTx.txHash);
      } catch (e) {
        this.logger.warn(
          `An error occurred while processing cross chain transaction ${crossChainTx.txHash}. Will be retried`,
          e,
        );
        await this.slackApi.sendWarn(
          `Cross chain transaction processing error`,
          `An error occurred while processing cross chain transaction ${crossChainTx.txHash}. Will be retried`,
        );
      }
    }

    return { processedTxs, updatedTxs };
  }

  private async handleEvents(transaction: Transaction, fee: string) {
    const eventsToSend = [];
    const approvalEvents = [];
    let hasContractCall = false;

    const events = mapRawEventsToSmartContractEvents(transaction.events);

    for (const [index, rawEvent] of events.entries()) {
      const address = rawEvent.contract_log.contract_id;
      let transferAmount = '0';
      if (transaction.tx_type === 'token_transfer') {
        transferAmount = transaction.token_transfer.amount;
      }

      if (address === this.contractGatewayStorage) {
        const event = await this.gatewayProcessor.handleGatewayEvent(
          rawEvent,
          transaction,
          rawEvent.event_index,
          fee,
          transferAmount,
        );

        if (event) {
          eventsToSend.push(event);

          if (event.type === 'MESSAGE_APPROVED') {
            approvalEvents.push(event as MessageApprovedEvent);
          }

          if (event.type === 'CALL') {
            hasContractCall = true;
          }
        }

        continue;
      }

      if (address === this.contractGasServiceStorage) {
        const event = await this.gasServiceProcessor.handleGasServiceEvent(
          rawEvent,
          transaction,
          index,
          rawEvent.event_index,
          fee,
        );

        if (event) {
          eventsToSend.push(event);
        }
      }

      if (address === this.contractItsStorage) {
        const event = this.itsProcessor.handleItsEvent(rawEvent, transaction, rawEvent.event_index);

        if (event) {
          eventsToSend.push(event);
        }
      }
    }

    return { eventsToSend, approvalEvents, hasContractCall };
  }

  private async sendEvents(eventsToSend: Event[], approvalEvents: MessageApprovedEvent[], transaction: Transaction, fee: string) {
    if (!eventsToSend.length) {
      return;
    }

    // Set cost for approval events if needed
    for (const approvalEvent of approvalEvents) {
      approvalEvent.cost.amount = String(BigInt(fee) / BigInt(approvalEvents.length));
    }

    try {
      await this.axelarGmpApi.postEvents(eventsToSend, transaction.tx_id);
    } catch (e) {
      this.logger.error('Could not send all events to GMP API...', e);
      await this.slackApi.sendError(
        'Axelar GMP API error',
        'Could not send all events to GMP API from CrossChainTransactionProcessor...',
      );

      if (e instanceof AxiosError) {
        this.logger.error(e.response?.data);
      }

      throw e;
    }
  }
}
