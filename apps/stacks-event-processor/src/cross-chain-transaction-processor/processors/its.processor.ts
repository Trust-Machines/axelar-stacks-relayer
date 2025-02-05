import { Injectable, Logger } from '@nestjs/common';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { getEventType, ScEvent } from '../../event-processor/types';
import { ItsContract } from '@stacks-monorepo/common/contracts/ITS/its.contract';
import { DecodingUtils } from '@stacks-monorepo/common/utils/decoding.utils';
import { BinaryUtils } from '@stacks-monorepo/common';
import Event = Components.Schemas.Event;
import ITSInterchainTokenDeploymentStartedEvent = Components.Schemas.ITSInterchainTokenDeploymentStartedEvent;
import ITSInterchainTransferEvent = Components.Schemas.ITSInterchainTransferEvent;

@Injectable()
export class ItsProcessor {
  private logger: Logger;

  constructor(private readonly itsContract: ItsContract) {
    this.logger = new Logger(ItsProcessor.name);
  }

  handleItsEvent(rawEvent: ScEvent, transaction: Transaction, index: number): Event | undefined {
    const eventName = getEventType(rawEvent);

    if (eventName === Events.INTERCHAIN_TOKEN_DEPLOYMENT_STARTED) {
      return this.handleInterchainTokenDeploymentStartedEvent(
        rawEvent,
        transaction.tx_id,
        transaction.block_time_iso,
        transaction.sender_address,
        index,
      );
    }

    if (eventName === Events.INTERCHAIN_TRANSFER) {
      return this.handleInterchainTransferEvent(
        rawEvent,
        transaction.tx_id,
        transaction.block_time_iso,
        transaction.sender_address,
        index,
      );
    }

    return undefined;
  }

  private handleInterchainTokenDeploymentStartedEvent(
    rawEvent: ScEvent,
    txHash: string,
    timestamp: string,
    senderAddress: string,
    index: number,
  ): Event {
    const interchainTokenDeploymentStartedEvent =
      this.itsContract.decodeInterchainTokenDeploymentStartedEvent(rawEvent);

    const event: ITSInterchainTokenDeploymentStartedEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      messageID: DecodingUtils.getEventId(txHash, index + 3), // Contract Call event happens after this event
      destinationChain: interchainTokenDeploymentStartedEvent.destinationChain,
      token: {
        id: interchainTokenDeploymentStartedEvent.tokenId,
        name: interchainTokenDeploymentStartedEvent.name,
        symbol: interchainTokenDeploymentStartedEvent.symbol,
        decimals: interchainTokenDeploymentStartedEvent.decimals,
      },
      meta: {
        txID: txHash,
        fromAddress: senderAddress,
        finalized: true,
        timestamp,
      },
    };

    this.logger.debug(
      `Successfully handled interchain token deployment started event from transaction ${txHash}, log index ${index}`,
      event,
    );

    return {
      type: 'ITS/INTERCHAIN_TOKEN_DEPLOYMENT_STARTED',
      ...event,
    };
  }

  private handleInterchainTransferEvent(
    rawEvent: ScEvent,
    txHash: string,
    timestamp: string,
    senderAddress: string,
    index: number,
  ): Event {
    const interchainTransferEvent = this.itsContract.decodeInterchainTransferEvent(rawEvent);

    const event: ITSInterchainTransferEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      messageID: DecodingUtils.getEventId(txHash, index + 3), // Contract Call event happens after this event
      destinationChain: interchainTransferEvent.destinationChain,
      tokenSpent: {
        tokenID: interchainTransferEvent.tokenId,
        amount: interchainTransferEvent.amount,
      },
      sourceAddress: interchainTransferEvent.sourceAddress,
      destinationAddress: BinaryUtils.hexToBase64(interchainTransferEvent.destinationAddress),
      dataHash: BinaryUtils.hexToBase64(interchainTransferEvent.data),
      meta: {
        txID: txHash,
        fromAddress: senderAddress,
        finalized: true,
        timestamp,
      },
    };

    this.logger.debug(
      `Successfully handled interchain transfer event from transaction ${txHash}, log index ${index}`,
      event,
    );

    return {
      type: 'ITS/INTERCHAIN_TRANSFER',
      ...event,
    };
  }
}
