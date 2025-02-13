import { Injectable, Logger } from '@nestjs/common';
import { ApiConfigService, GatewayContract, mapRawEventsToSmartContractEvents } from '@stacks-monorepo/common';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import {
  GasAddedEvent,
  GasPaidForContractCallEvent,
  RefundedEvent,
} from '@stacks-monorepo/common/contracts/entities/gas-service-events';
import { GasServiceContract } from '@stacks-monorepo/common/contracts/gas-service.contract';
import { DecodingUtils } from '@stacks-monorepo/common/utils/decoding.utils';
import { Events } from '@stacks-monorepo/common/utils/event.enum';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { getEventType, ScEvent } from '../../event-processor/types';
import GasRefundedEvent = Components.Schemas.GasRefundedEvent;
import Event = Components.Schemas.Event;
import GasCreditEvent = Components.Schemas.GasCreditEvent;

@Injectable()
export class GasServiceProcessor {
  private readonly contractGatewayStorage: string;
  private logger: Logger;

  constructor(
    private readonly gasServiceContract: GasServiceContract,
    private readonly gatewayContract: GatewayContract,
    apiConfigService: ApiConfigService,
  ) {
    this.contractGatewayStorage = apiConfigService.getContractGatewayStorage();
    this.logger = new Logger(GasServiceProcessor.name);
  }

  handleGasServiceEvent(
    rawEvent: ScEvent,
    transaction: Transaction,
    index: number,
    eventIndex: number,
    fee: string,
  ): Event | undefined {
    const eventName = getEventType(rawEvent);

    if (eventName === Events.NATIVE_GAS_PAID_FOR_CONTRACT_CALL_EVENT) {
      const gasEvent = this.gasServiceContract.decodeNativeGasPaidForContractCallEvent(rawEvent);

      const callContractIndex = this.findCorrespondingCallContractEvent(transaction, index, gasEvent);

      if (callContractIndex === -1) {
        this.logger.warn(
          `Received Native Gas Paid For Contract Call event but could not find corresponding Call Contract event. Transaction: ${transaction.tx_id}`,
          gasEvent,
        );

        return undefined;
      }

      return this.handleGasPaidEvent(
        gasEvent,
        transaction.tx_id,
        eventIndex,
        callContractIndex,
        transaction.block_time_iso,
      );
    }

    if (eventName === Events.NATIVE_GAS_ADDED_EVENT) {
      const event = this.gasServiceContract.decodeNativeGasAddedEvent(rawEvent);

      return this.handleGasAddedEvent(
        event,
        transaction.sender_address,
        transaction.tx_id,
        eventIndex,
        transaction.block_time_iso,
      );
    }

    if (eventName === Events.REFUNDED_EVENT) {
      const event = this.gasServiceContract.decodeRefundedEvent(rawEvent);

      return this.handleRefundedEvent(
        event,
        transaction.sender_address,
        transaction.tx_id,
        eventIndex,
        fee,
        transaction.block_time_iso,
      );
    }

    return undefined;
  }

  private handleGasPaidEvent(
    event: GasPaidForContractCallEvent,
    txHash: string,
    index: number,
    contractCallIndex: number,
    timestamp: string,
  ): Event | undefined {
    const gasCreditEvent: GasCreditEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      messageID: DecodingUtils.getEventId(txHash, contractCallIndex),
      refundAddress: event.refundAddress,
      payment: {
        tokenID: null, // null if STX
        amount: event.amount.toFixed(),
      },
      meta: {
        txID: txHash,
        fromAddress: event.sender,
        finalized: true,
        timestamp,
      },
    };

    this.logger.debug(
      `Successfully handled gas paid event from transaction ${txHash}, log index ${index}`,
      gasCreditEvent,
    );

    return {
      type: 'GAS_CREDIT',
      ...gasCreditEvent,
    };
  }

  private handleGasAddedEvent(
    event: GasAddedEvent,
    sender: string,
    txHash: string,
    index: number,
    timestamp: string,
  ): Event | undefined {
    const gasCreditEvent: GasCreditEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      messageID: DecodingUtils.getEventId(event.txHash, event.logIndex),
      refundAddress: event.refundAddress,
      payment: {
        tokenID: null, // null if STX
        amount: event.amount.toFixed(),
      },
      meta: {
        txID: txHash,
        fromAddress: sender,
        finalized: true,
        timestamp,
      },
    };

    this.logger.debug(
      `Successfully handled gas added event from transaction ${txHash}, log index ${index}`,
      gasCreditEvent,
    );

    return {
      type: 'GAS_CREDIT',
      ...gasCreditEvent,
    };
  }

  private handleRefundedEvent(
    event: RefundedEvent,
    sender: string,
    txHash: string,
    index: number,
    fee: string,
    timestamp: string,
  ): Event | undefined {
    const gasRefundedEvent: GasRefundedEvent = {
      eventID: DecodingUtils.getEventId(txHash, index),
      messageID: DecodingUtils.getEventId(event.txHash, event.logIndex),
      recipientAddress: event.receiver,
      refundedAmount: {
        tokenID: null, // null if STX
        amount: event.amount.toFixed(),
      },
      cost: {
        amount: fee,
      },
      meta: {
        txID: txHash,
        fromAddress: sender,
        finalized: true,
        timestamp,
      },
    };

    this.logger.debug(
      `Successfully handled gas refunded event from transaction ${txHash}, log index ${index}`,
      gasRefundedEvent,
    );

    return {
      type: 'GAS_REFUNDED',
      ...gasRefundedEvent,
    };
  }

  private findCorrespondingCallContractEvent(
    transaction: Transaction,
    index: number,
    gasEvent: GasPaidForContractCallEvent,
  ) {
    const events = mapRawEventsToSmartContractEvents(transaction.events);

    // Search for the first corresponding callContract event starting from the current gas paid event index
    const foundEvent = events.slice(index + 1).find((event) => {
      const eventName = getEventType(event);
      const address = event.contract_log.contract_id;

      if (address === this.contractGatewayStorage && eventName === Events.CONTRACT_CALL_EVENT) {
        const contractCallEvent = this.gatewayContract.decodeContractCallEvent(event);

        return (
          gasEvent.sender === contractCallEvent.sender &&
          gasEvent.destinationChain === contractCallEvent.destinationChain &&
          gasEvent.destinationAddress === contractCallEvent.destinationAddress &&
          gasEvent.payloadHash === contractCallEvent.payloadHash
        );
      }

      return false;
    });

    return foundEvent ? foundEvent.event_index : -1;
  }
}
