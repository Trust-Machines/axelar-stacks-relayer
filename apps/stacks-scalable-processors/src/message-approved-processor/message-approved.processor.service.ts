import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MessageApproved, MessageApprovedStatus } from '@prisma/client';
import { ApiConfigService, AxelarGmpApi, GatewayContract, Locker } from '@stacks-monorepo/common';
import { CannotExecuteMessageEventV2, Event } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { GasError } from '@stacks-monorepo/common/contracts/entities/gas.error';
import { TooLowAvailableBalanceError } from '@stacks-monorepo/common/contracts/entities/too-low-available-balance.error';
import { ItsContract, MessageApprovedData } from '@stacks-monorepo/common/contracts/ITS/its.contract';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksNetwork } from '@stacks/network';
import { AnchorMode, bufferCV, principalCV, StacksTransaction, stringAsciiCV } from '@stacks/transactions';
import { AxiosError } from 'axios';
import { ItsError } from '@stacks-monorepo/common/contracts/entities/its.error';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

// Support a max of 3 retries (mainly because some Interchain Token Service endpoints need to be called 2 times)
const MAX_NUMBER_OF_RETRIES: number = 3;

@Injectable()
export class MessageApprovedProcessorService {
  private readonly logger: Logger;

  private readonly contractItsAddress: string;

  constructor(
    private readonly messageApprovedRepository: MessageApprovedRepository,
    @Inject(ProviderKeys.WALLET_SIGNER) private readonly walletSigner: string,
    private readonly transactionsHelper: TransactionsHelper,
    private readonly itsContract: ItsContract,
    private readonly axelarGmpApi: AxelarGmpApi,
    apiConfigService: ApiConfigService,
    @Inject(ProviderKeys.STACKS_NETWORK) private readonly network: StacksNetwork,
    private readonly gatewayContract: GatewayContract,
    private readonly slackApi: SlackApi,
  ) {
    this.logger = new Logger(MessageApprovedProcessorService.name);
    this.contractItsAddress = apiConfigService.getContractItsProxy();
  }

  // Runs after Axelar EventProcessor newTasks cron has run
  @Cron('7/10 * * * * *')
  async processPendingMessageApproved() {
    await Locker.lock('processPendingMessageApproved', async () => {
      this.logger.debug('Running processPendingMessageApproved cron');

      let processedItems;
      do {
        try {
          processedItems = await this.messageApprovedRepository.processPending(
            this.processPendingMessageApprovedRaw.bind(this),
          );
        } catch (e) {
          if (e instanceof PrismaClientKnownRequestError && e.code === 'P2028') {
            // Transaction timeout
            this.logger.warn('Message approved processing has timed out. Will be retried');
            await this.slackApi.sendWarn(
              `Message approved processing timeout`,
              `Processing has timed out. Will be retried`,
            );
          }
          throw e;
        }
      } while (processedItems.length > 0);
    });
  }

  async processPendingMessageApprovedRaw(items: MessageApproved[]) {
    this.logger.log(`Found ${items.length} MessageApproved transactions to execute`);

    const transactionsToSend: StacksTransaction[] = [];
    const entriesToUpdate: MessageApproved[] = [];
    const entriesWithTransactions: MessageApproved[] = [];
    for (const messageApproved of items) {
      if (messageApproved.retry >= MAX_NUMBER_OF_RETRIES) {
        await this.handleMessageApprovedFailed(messageApproved, 'ERROR');

        entriesToUpdate.push(messageApproved);

        continue;
      }

      this.logger.debug(
        `Trying to execute MessageApproved transaction from ${messageApproved.sourceChain} with message id ${messageApproved.messageId}`,
      );

      if (!messageApproved.payload.length) {
        this.logger.error(
          `Can not send transaction without payload from ${messageApproved.sourceChain} with message id ${messageApproved.messageId}`,
        );
        await this.slackApi.sendError(
          'Message approved payload error',
          `Can not send transaction without payload from ${messageApproved.sourceChain} with message id ${messageApproved.messageId}`,
        );

        messageApproved.status = MessageApprovedStatus.FAILED;

        entriesToUpdate.push(messageApproved);

        continue;
      }

      try {
        const { transaction, incrementRetry, extraData } = await this.buildExecuteTransaction(messageApproved);

        messageApproved.extraData = extraData;

        if (incrementRetry) {
          messageApproved.retry += 1;
          messageApproved.executeTxHash = null;
        }

        if (!transaction) {
          entriesToUpdate.push(messageApproved);

          continue;
        }

        transactionsToSend.push(transaction);

        messageApproved.executeTxHash = transaction.txid();

        entriesWithTransactions.push(messageApproved);
      } catch (e) {
        this.logger.warn(
          `Could not build and sign execute transaction for chain ${messageApproved.sourceChain}: ${messageApproved.messageId}. Will be retried`,
          e,
        );
        await this.slackApi.sendWarn(
          'Message approved error',
          `Could not build and sign execute transaction for chain ${messageApproved.sourceChain}: ${messageApproved.messageId}. Will be retried`,
        );

        await this.transactionsHelper.deleteNonce();

        if (e instanceof GasError || e instanceof ItsError) {
          messageApproved.retry += 1;

          entriesToUpdate.push(messageApproved);
        } else if (e instanceof TooLowAvailableBalanceError) {
          await this.handleMessageApprovedFailed(messageApproved, 'INSUFFICIENT_GAS');

          entriesToUpdate.push(messageApproved);
        } else {
          throw e;
        }
      }
    }

    const hashes = await this.transactionsHelper.sendTransactions(transactionsToSend);

    if (hashes) {
      for (const entry of entriesWithTransactions) {
        const sent = hashes.includes(entry.executeTxHash as string);

        entriesToUpdate.push(entry);

        // If not sent revert fields but still save to the database so it is retried later and does
        // not block the processing. Break is used to not update the next transactions so that
        // they can be executed again in the next iteration, since all the other transactions after the failed one
        // were also not sent
        if (!sent) {
          entry.executeTxHash = null;
          break;
        }
      }
    }

    return entriesToUpdate;
  }

  private async buildExecuteTransaction(messageApproved: MessageApproved): Promise<MessageApprovedData> {
    const contractId = messageApproved.contractAddress;
    const contractSplit = contractId.split('.');
    const [contractAddress, contractName] = [contractSplit[0], contractSplit[1]];

    if (contractId === this.contractItsAddress) {
      return await this.itsContract.execute(
        this.walletSigner,
        messageApproved.sourceChain,
        messageApproved.messageId,
        messageApproved.sourceAddress,
        messageApproved.contractAddress,
        messageApproved.payload.toString('hex'),
        messageApproved.availableGasBalance,
        messageApproved.executeTxHash,
        // @ts-ignore
        messageApproved.extraData,
      );
    }

    const gatewayImpl = await this.gatewayContract.getGatewayImpl();

    const transaction = await this.transactionsHelper.makeContractCall({
      contractAddress: contractAddress,
      contractName: contractName,
      functionName: 'execute',
      functionArgs: [
        principalCV(gatewayImpl),
        stringAsciiCV(messageApproved.sourceChain),
        stringAsciiCV(messageApproved.messageId),
        stringAsciiCV(messageApproved.sourceAddress),
        bufferCV(messageApproved.payload),
      ],
      senderKey: this.walletSigner,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });

    await this.transactionsHelper.checkAvailableGasBalance(
      messageApproved.messageId,
      messageApproved.availableGasBalance,
      [{ transaction }],
    );

    return { transaction, incrementRetry: true, extraData: null };
  }

  async handleMessageApprovedFailed(messageApproved: MessageApproved, reason: 'INSUFFICIENT_GAS' | 'ERROR') {
    if (reason === 'INSUFFICIENT_GAS') {
      this.logger.warn(
        `Could not execute MessageApproved from ${messageApproved.sourceChain} with message id ${messageApproved.messageId} after ${messageApproved.retry} retries, INSUFFICIENT_GAS`,
      );
      await this.slackApi.sendWarn(
        `Message approved failed`,
        `Could not execute MessageApproved from ${messageApproved.sourceChain} with message id ${messageApproved.messageId} after ${messageApproved.retry} retries, INSUFFICIENT_GAS`,
      );
    } else {
      this.logger.error(
        `Could not execute MessageApproved from ${messageApproved.sourceChain} with message id ${messageApproved.messageId} after ${messageApproved.retry} retries, ERROR`,
      );
      await this.slackApi.sendError(
        `Message approved failed`,
        `Could not execute MessageApproved from ${messageApproved.sourceChain} with message id ${messageApproved.messageId} after ${messageApproved.retry} retries, ERROR`,
      );
    }

    const cannotExecuteEvent: CannotExecuteMessageEventV2 = {
      eventID: messageApproved.messageId,
      messageID: messageApproved.messageId,
      sourceChain: CONSTANTS.SOURCE_CHAIN_NAME,
      reason,
      details: `retried ${messageApproved.retry} times`,
      meta: {
        txID: messageApproved.executeTxHash,
        taskItemID: messageApproved.taskItemId || '',
      },
    };

    const eventsToSend: Event[] = [
      {
        type: 'CANNOT_EXECUTE_MESSAGE/V2',
        ...cannotExecuteEvent,
      },
    ];

    try {
      await this.axelarGmpApi.postEvents(eventsToSend, messageApproved.executeTxHash || '');

      // Only update status after events were successfully sent
      messageApproved.status = MessageApprovedStatus.FAILED;
    } catch (e) {
      this.logger.warn(
        `Could not send all events to GMP API ofr message approved from ${messageApproved.sourceChain} with message id ${messageApproved.messageId}. Will be retried`,
        e,
      );
      await this.slackApi.sendWarn(
        'Axelar GMP API error',
        'Could not send all events to GMP API ofr message approved from ${messageApproved.sourceChain} with message id ${messageApproved.messageId}. Will be retried',
      );

      if (e instanceof AxiosError) {
        this.logger.error(e.response?.data);
      }
    }
  }
}
