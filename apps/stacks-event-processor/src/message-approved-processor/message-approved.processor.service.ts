import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MessageApproved, MessageApprovedStatus } from '@prisma/client';
import { ApiConfigService, AxelarGmpApi, BinaryUtils, Locker } from '@stacks-monorepo/common';
import { CannotExecuteMessageEvent, Event } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { GasError } from '@stacks-monorepo/common/contracts/entities/gas.error';
import { ItsContract } from '@stacks-monorepo/common/contracts/its.contract';
import { TransactionsHelper } from '@stacks-monorepo/common/contracts/transactions.helper';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksNetwork } from '@stacks/network';
import {
  AnchorMode,
  bufferCV,
  bufferCVFromString,
  makeContractCall,
  StacksTransaction,
  stringAsciiCV,
} from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { AxiosError } from 'axios';

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
  ) {
    this.logger = new Logger(MessageApprovedProcessorService.name);
    this.contractItsAddress = apiConfigService.getContractIts();
  }

  @Cron('10/15 * * * * *')
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
            await this.handleMessageApprovedFailed(messageApproved);

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
            const transaction = await this.buildExecuteTransaction(messageApproved);

            const gas = await this.transactionsHelper.getTransactionGas(transaction, messageApproved.retry);
            transaction.setFee(gas);

            transactionsToSend.push(transaction);

            messageApproved.executeTxHash = transaction.txid();
            messageApproved.retry += 1;

            entriesWithTransactions.push(messageApproved);
          } catch (e) {
            this.logger.error(
              `Could not build and sign execute transaction for ${messageApproved.sourceChain} ${messageApproved.messageId}`,
              e,
            );

            if (e instanceof GasError) {
              messageApproved.retry += 1;

              entriesToUpdate.push(messageApproved);
            } else {
              throw e;
            }
          }
        }

        const hashes = await this.transactionsHelper.sendTransactions(transactionsToSend);

        if (hashes) {
          entriesWithTransactions.forEach((entry) => {
            const sent = hashes.includes(entry.executeTxHash as string);

            // If not sent revert fields but still save to database so it is retried later and does
            // not block the processing
            if (!sent) {
              entry.executeTxHash = null;
              entry.retry = entry.retry === 1 ? 1 : entry.retry - 1; // retry should be 1 or more to not be processed immediately
            }

            entriesToUpdate.push(entry);
          });
        }

        if (entriesToUpdate.length) {
          await this.messageApprovedRepository.updateManyPartial(entriesToUpdate);
        }
      }
    });
  }

  private async buildExecuteTransaction(messageApproved: MessageApproved): Promise<StacksTransaction> {
    const contractId = messageApproved.contractAddress;
    const contractSplit = contractId.split('.');
    const [contractAddress, contractName] = [contractSplit[0], contractSplit[1]];

    if (contractAddress !== this.contractItsAddress) {
      const tx = await makeContractCall({
        contractAddress: contractAddress,
        contractName: contractName,
        functionName: 'execute',
        functionArgs: [
          bufferCVFromString(messageApproved.sourceChain),
          bufferFromHex(BinaryUtils.stringToHex(messageApproved.messageId)),
          bufferFromHex(BinaryUtils.stringToHex(messageApproved.sourceAddress)),
          bufferCV(messageApproved.payload),
        ],
        senderKey: this.walletSigner,
        network: this.network,
        anchorMode: AnchorMode.Any,
      });

      return tx;
    }

    // In case first transaction exists for ITS, wait for it to complete and mark it as successful if necessary
    if (messageApproved.executeTxHash && !messageApproved.successTimes) {
      const success = await this.transactionsHelper.awaitSuccess(messageApproved.executeTxHash);

      if (success) {
        messageApproved.successTimes = 1;
      }
    }

    return await this.itsContract.execute(
      this.walletSigner,
      messageApproved.sourceChain,
      messageApproved.messageId,
      messageApproved.sourceAddress,
      messageApproved.payload,
      messageApproved.successTimes || 0,
    );
  }

  private async handleMessageApprovedFailed(messageApproved: MessageApproved) {
    this.logger.error(
      `Could not execute MessageApproved from ${messageApproved.sourceChain} with message id ${messageApproved.messageId} after ${messageApproved.retry} retries`,
    );

    messageApproved.status = MessageApprovedStatus.FAILED;

    const cannotExecuteEvent: CannotExecuteMessageEvent = {
      eventID: messageApproved.messageId,
      taskItemID: messageApproved.taskItemId || '',
      reason: 'ERROR',
      details: '',
    };

    try {
      const eventsToSend: Event[] = [
        {
          type: 'CANNOT_EXECUTE_MESSAGE',
          ...cannotExecuteEvent,
        },
      ];

      await this.axelarGmpApi.postEvents(eventsToSend, messageApproved.executeTxHash || '');
    } catch (e) {
      this.logger.error('Could not send all events to GMP API...', e);

      if (e instanceof AxiosError) {
        this.logger.error(e.response);
      }

      throw e;
    }
  }
}
