import { Injectable, Logger } from '@nestjs/common';
import { MessageApprovedStatus, StacksTransactionStatus, StacksTransactionType } from '@prisma/client';
import { BinaryUtils, GatewayContract } from '@stacks-monorepo/common';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { DecodingUtils } from '@stacks-monorepo/common/utils/decoding.utils';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import BigNumber from 'bignumber.js';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import { StacksTransactionRepository } from '@stacks-monorepo/common/database/repository/stacks-transaction.repository';
import { getEventType, ScEvent } from '@stacks-monorepo/common/utils';
import CallEvent = Components.Schemas.CallEvent;
import MessageApprovedEvent = Components.Schemas.MessageApprovedEvent;
import Event = Components.Schemas.Event;
import MessageExecutedEvent = Components.Schemas.MessageExecutedEvent;
import SignersRotatedEvent = Components.Schemas.SignersRotatedEvent;

@Injectable()
export class GatewayProcessor {
  private logger: Logger;

  constructor(
    private readonly gatewayContract: GatewayContract,
    private readonly messageApprovedRepository: MessageApprovedRepository,
    private readonly slackApi: SlackApi,
    private readonly stacksTransactionRepository: StacksTransactionRepository,
  ) {
    this.logger = new Logger(GatewayProcessor.name);
  }

  async handleGatewayEvent(
    rawEvent: ScEvent,
    transaction: Transaction,
    index: number,
    fee: string,
    transactionValue: string,
  ): Promise<Event | undefined> {
    const eventName = getEventType(rawEvent);

    if (eventName === Events.CONTRACT_CALL_EVENT) {
      return this.handleContractCallEvent(
        rawEvent,
        transaction.tx_id,
        transaction.block_time_iso,
        transaction.sender_address,
        index,
      );
    }

    if (eventName === Events.MESSAGE_APPROVED_EVENT) {
      return await this.handleMessageApprovedEvent(
        rawEvent,
        transaction.sender_address,
        transaction.tx_id,
        transaction.block_time_iso,
        index,
      );
    }

    if (eventName === Events.MESSAGE_EXECUTED_EVENT) {
      return await this.handleMessageExecutedEvent(
        rawEvent,
        transaction.sender_address,
        transaction.tx_id,
        index,
        fee,
        transaction.block_time_iso,
        transactionValue,
      );
    }

    if (eventName === Events.SIGNERS_ROTATED_EVENT) {
      return this.handleSignersRotatedEvent(
        rawEvent,
        transaction.tx_id,
        transaction.sender_address,
        transaction.block_time_iso,
        index,
      );
    }

    return undefined;
  }

  private handleContractCallEvent(
    rawEvent: ScEvent,
    txHash: string,
    timestamp: string,
    senderAddress: string,
    index: number,
  ): Event | undefined {
    const contractCallEvent = this.gatewayContract.decodeContractCallEvent(rawEvent);

    const payload = contractCallEvent.payload.toString('base64');
    const payloadHash = BinaryUtils.hexToBase64(contractCallEvent.payloadHash);

    const callEvent: CallEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      message: {
        messageID: DecodingUtils.getEventId(txHash, index),
        sourceChain: CONSTANTS.SOURCE_CHAIN_NAME,
        sourceAddress: contractCallEvent.sender,
        destinationAddress: contractCallEvent.destinationAddress,
        payloadHash,
      },
      destinationChain: contractCallEvent.destinationChain,
      payload,
      meta: {
        txID: txHash,
        fromAddress: senderAddress,
        finalized: true,
        timestamp,
      },
    };

    this.logger.log(
      `Successfully handled contract call event from transaction ${txHash}, log index ${index}`,
      callEvent,
    );

    return {
      type: 'CALL',
      ...callEvent,
    };
  }

  private async handleMessageApprovedEvent(
    rawEvent: ScEvent,
    sender: string,
    txHash: string,
    timestamp: string,
    index: number,
  ): Promise<Event> {
    const statusUpdated = await this.stacksTransactionRepository.updateStatusIfItExists(
      StacksTransactionType.GATEWAY,
      BinaryUtils.removeHexPrefix(txHash),
      StacksTransactionStatus.SUCCESS,
    );

    if (statusUpdated) {
      this.logger.log(`Successfully executed GATEWAY transaction with hash ${txHash}`);
    }

    const event = this.gatewayContract.decodeMessageApprovedEvent(rawEvent);

    const messageApproved: MessageApprovedEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      message: {
        messageID: event.messageId,
        sourceChain: event.sourceChain,
        sourceAddress: event.sourceAddress,
        destinationAddress: event.contractAddress,
        payloadHash: BinaryUtils.hexToBase64(event.payloadHash),
      },
      cost: {
        amount: '0', // This will be set later since multiple approvals can happen in the same transaction
      },
      meta: {
        txID: txHash,
        fromAddress: sender,
        finalized: true,
        timestamp,
      },
    };

    this.logger.log(
      `Successfully handled message approved event from transaction ${txHash}, log index ${index}`,
      messageApproved,
    );

    return {
      type: 'MESSAGE_APPROVED',
      ...messageApproved,
    };
  }

  private async handleMessageExecutedEvent(
    rawEvent: ScEvent,
    sender: string,
    txHash: string,
    index: number,
    fee: string,
    timestamp: string,
    transactionValue: string,
  ): Promise<Event | undefined> {
    const messageExecutedEvent = this.gatewayContract.decodeMessageExecutedEvent(rawEvent);

    const statusUpdated = await this.messageApprovedRepository.updateStatusIfItExists(
      messageExecutedEvent.sourceChain,
      messageExecutedEvent.messageId,
      MessageApprovedStatus.SUCCESS,
    );

    if (!statusUpdated) {
      this.logger.warn(
        `Could not find corresponding message approved for message executed event in database from ${messageExecutedEvent.sourceChain} with message id ${messageExecutedEvent.messageId}`,
      );
      await this.slackApi.sendWarn(
        'Message approved error',
        `Could not find corresponding message approved for message executed event in database from ${messageExecutedEvent.sourceChain} with message id ${messageExecutedEvent.messageId}`,
      );
    }

    const messageExecuted: MessageExecutedEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      messageID: messageExecutedEvent.messageId,
      sourceChain: messageExecutedEvent.sourceChain,
      cost: {
        amount: new BigNumber(fee).plus(transactionValue, 10).toFixed(), // Also add transaction value to fee, i.e in case of ITS execute with ESDT issue cost
      },
      meta: {
        txID: txHash,
        fromAddress: sender,
        finalized: true,
        timestamp,
      },
      status: 'SUCCESSFUL',
    };

    this.logger.log(
      `Successfully executed message from ${messageExecutedEvent.sourceChain} with message id ${messageExecutedEvent.messageId}`,
      messageExecuted,
    );

    return {
      type: 'MESSAGE_EXECUTED',
      ...messageExecuted,
    };
  }

  private handleSignersRotatedEvent(
    rawEvent: ScEvent,
    txHash: string,
    sender: string,
    timestamp: string,
    index: number,
  ): Event | undefined {
    const weightedSigners = this.gatewayContract.decodeSignersRotatedEvent(rawEvent);

    const signersRotatedEvent: SignersRotatedEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      meta: {
        txID: txHash,
        timestamp: timestamp,
        fromAddress: sender,
        finalized: true,
        signersHash: weightedSigners.signersHash.toString('base64'),
        epoch: weightedSigners.epoch,
      },
      messageID: DecodingUtils.getEventId(txHash, index),
    };

    this.logger.log(
      `Successfully handled signers rotated event from transaction ${txHash}, log index ${index}`,
      signersRotatedEvent,
    );

    return {
      type: 'SIGNERS_ROTATED',
      ...signersRotatedEvent,
    };
  }
}
