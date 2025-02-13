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
  ) {
    this.logger = new Logger(MessageApprovedProcessorService.name);
    this.contractItsAddress = apiConfigService.getContractItsProxy();
  }

  // Runs after Axelar EventProcessor newTasks cron has run
  @Cron('7/15 * * * * *')
  async processPendingMessageApproved() {
    await Locker.lock('processPendingMessageApproved', async () => {
      this.logger.debug('Running processPendingMessageApproved cron');

      // Always start processing from beginning (page 0) since the query will skip recently updated entries
      let entries;
      while ((entries = await this.messageApprovedRepository.findPending(0))?.length) {
        this.logger.log(`Found ${entries.length} CallContractApproved transactions to execute`);

        const transactionsToSend: StacksTransaction[] = [];
        const entriesToUpdate: MessageApproved[] = [];
        const entriesWithTransactions: MessageApproved[] = [];
        for (const messageApproved of entries) {
          if (messageApproved.retry === MAX_NUMBER_OF_RETRIES) {
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
            this.logger.error(
              `Could not build and sign execute transaction for ${messageApproved.sourceChain} ${messageApproved.messageId}`,
              e,
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

            // If not sent revert fields but still save to database so it is retried later and does
            // not block the processing. Break is used to not update the next transactions so that
            // they can be executed again in the next iteration
            if (!sent) {
              entry.executeTxHash = null;
              break;
            }
          }
        }

        if (entriesToUpdate.length) {
          await this.messageApprovedRepository.updateManyPartial(entriesToUpdate);
        }
      }
    });
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
        stringAsciiCV(messageApproved.sourceChain),
        stringAsciiCV(messageApproved.messageId),
        stringAsciiCV(messageApproved.sourceAddress),
        bufferCV(messageApproved.payload),
        principalCV(gatewayImpl),
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
    this.logger.error(
      `Could not execute MessageApproved from ${messageApproved.sourceChain} with message id ${messageApproved.messageId} after ${messageApproved.retry} retries`,
    );

    messageApproved.status = MessageApprovedStatus.FAILED;

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

    try {
      const eventsToSend: Event[] = [
        {
          type: 'CANNOT_EXECUTE_MESSAGE/V2',
          ...cannotExecuteEvent,
        },
      ];

      await this.axelarGmpApi.postEvents(eventsToSend, messageApproved.executeTxHash || '');
    } catch (e) {
      this.logger.error('Could not send all events to GMP API...', e);

      if (e instanceof AxiosError) {
        this.logger.error(e.response?.data);
      }
    }
  }
}
