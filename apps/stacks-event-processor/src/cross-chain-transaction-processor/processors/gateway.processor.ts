import { BinaryUtils } from '@multiversx/sdk-nestjs-common';
import { Injectable, Logger } from '@nestjs/common';
import { MessageApprovedStatus } from '@prisma/client';
import { GatewayContract } from '@stacks-monorepo/common';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { MessageApprovedRepository } from '@stacks-monorepo/common/database/repository/message-approved.repository';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { DecodingUtils } from '@stacks-monorepo/common/utils/decoding.utils';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import BigNumber from 'bignumber.js';
import { getEventType, ScEvent } from '../../event-processor/types';
import CallEvent = Components.Schemas.CallEvent;
import MessageApprovedEvent = Components.Schemas.MessageApprovedEvent;
import Event = Components.Schemas.Event;
import MessageExecutedEvent = Components.Schemas.MessageExecutedEvent;

@Injectable()
export class GatewayProcessor {
  private logger: Logger;

  constructor(
    private readonly gatewayContract: GatewayContract,
    private readonly messageApprovedRepository: MessageApprovedRepository,
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
      return this.handleContractCallEvent(rawEvent, transaction.tx_id, index);
    }

    if (eventName === Events.MESSAGE_APPROVED_EVENT) {
      return this.handleMessageApprovedEvent(rawEvent, transaction.sender_address, transaction.tx_id, index);
    }

    if (eventName === Events.MESSAGE_EXECUTED_EVENT) {
      return await this.handleMessageExecutedEvent(
        rawEvent,
        transaction.sender_address,
        transaction.tx_id,
        index,
        fee,
        transactionValue,
      );
    }

    if (eventName === Events.SIGNERS_ROTATED_EVENT) {
      return this.handleSignersRotatedEvent(rawEvent, transaction.tx_id, index);
    }

    return undefined;
  }

  private handleContractCallEvent(rawEvent: ScEvent, txHash: string, index: number): Event | undefined {
    const contractCallEvent = this.gatewayContract.decodeContractCallEvent(rawEvent);

    const callEvent: CallEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      message: {
        messageID: DecodingUtils.getEventId(txHash, index),
        sourceChain: CONSTANTS.SOURCE_CHAIN_NAME,
        sourceAddress: contractCallEvent.sender,
        destinationAddress: contractCallEvent.destinationAddress,
        payloadHash: BinaryUtils.hexToBase64(contractCallEvent.payloadHash),
      },
      destinationChain: contractCallEvent.destinationChain,
      payload: contractCallEvent.payload.toString('base64'),
      meta: {
        txID: txHash,
        fromAddress: contractCallEvent.sender,
        finalized: true,
      },
    };

    this.logger.debug(
      `Successfully handled contract call event from transaction ${txHash}, log index ${index}`,
      callEvent,
    );

    return {
      type: 'CALL',
      ...callEvent,
    };
  }

  private handleMessageApprovedEvent(rawEvent: ScEvent, sender: string, txHash: string, index: number): Event {
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
      },
    };

    this.logger.debug(
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
    transactionValue: string,
  ): Promise<Event | undefined> {
    const messageExecutedEvent = this.gatewayContract.decodeMessageExecutedEvent(rawEvent);

    const messageApproved = await this.messageApprovedRepository.findBySourceChainAndMessageId(
      messageExecutedEvent.sourceChain,
      messageExecutedEvent.messageId,
    );

    if (messageApproved) {
      messageApproved.status = MessageApprovedStatus.SUCCESS;
      messageApproved.successTimes = (messageApproved.successTimes || 0) + 1;

      await this.messageApprovedRepository.updateStatusAndSuccessTimes(messageApproved);
    } else {
      this.logger.warn(
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
      },
      status: 'SUCCESSFUL', // TODO: How to handle reverted?
    };

    this.logger.debug(
      `Successfully executed message from ${messageExecutedEvent.sourceChain} with message id ${messageExecutedEvent.messageId}`,
    );

    return {
      type: 'MESSAGE_EXECUTED',
      ...messageExecuted,
    };
  }

  // TODO: Properly implement this after the Axelar GMP API supports it
  private handleSignersRotatedEvent(rawEvent: ScEvent, txHash: string, index: number) {
    const weightedSigners = this.gatewayContract.decodeSignersRotatedEvent(rawEvent);

    this.logger.warn(
      `Received Signers Rotated event which is not properly implemented yet. Transaction:  ${txHash}, index: ${index}`,
      weightedSigners,
    );

    return undefined;

    // // The id needs to have `0x` in front of the txHash (hex string)
    // const id = `0x${txHash}-${index}`;
    //
    //
    // // @ts-ignore
    // const response = await this.axelarGmpApi.verifyVerifierSet(
    //   id,
    //   weightedSigners.signers,
    //   weightedSigners.threshold,
    //   weightedSigners.nonce,
    // );

    // if (response.published) {
    //   return;
    // }
    //
    // this.logger.warn(`Couldn't dispatch verifyWorkerSet ${id} to Amplifier API. Retrying...`);
    //
    // setTimeout(async () => {
    //   const response = await this.axelarGmpApi.verifyVerifierSet(
    //     id,
    //     weightedSigners.signers,
    //     weightedSigners.threshold,
    //     weightedSigners.nonce,
    //   );
    //
    //   if (!response.published) {
    //     this.logger.error(`Couldn't dispatch verifyWorkerSet ${id} to Amplifier API.`);
    //   }
    // }, 60_000);
  }
}
