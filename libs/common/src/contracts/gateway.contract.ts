import { Injectable } from '@nestjs/common';
import {
  ContractCallEvent,
  MessageApprovedEvent,
  MessageExecutedEvent,
  WeightedSignersEvent,
} from '@stacks-monorepo/common/contracts/entities/gateway-events';
import {
  contractCallDecoder,
  DecodingUtils,
  messageApprovedDecoder,
  messageExecutedDecoder,
  weightedSignersDecoder,
} from '@stacks-monorepo/common/utils/decoding.utils';
import { StacksNetwork } from '@stacks/network';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import BigNumber from 'bignumber.js';

@Injectable()
export class GatewayContract {
  constructor(
    private readonly contract: string,
    private readonly network: StacksNetwork,
  ) {}

  buildTransactionExternalFunction(externalData: string, sender: string, nonce: number): any {
    // TODO: implement Stacks transaction
    return {
      sender,
      nonce,
      // receiver: this.smartContract.getAddress(),
      receiver: '',
      // data: new TransactionPayload(externalData),
      gasLimit: 0, // These will actually be set before sending the transaction to the chain
      // chainID: this.chainId,
    };
  }

  decodeContractCallEvent(event: ScEvent): ContractCallEvent {
    return DecodingUtils.decodeEvent<ContractCallEvent>(event, contractCallDecoder);
  }

  decodeMessageApprovedEvent(event: ScEvent): MessageApprovedEvent {
    return DecodingUtils.decodeEvent<MessageApprovedEvent>(event, messageApprovedDecoder);
  }

  decodeMessageExecutedEvent(event: ScEvent): MessageExecutedEvent {
    return DecodingUtils.decodeEvent<MessageExecutedEvent>(event, messageExecutedDecoder);
  }

  decodeSignersRotatedEvent(event: ScEvent): WeightedSignersEvent {
    return DecodingUtils.decodeEvent<WeightedSignersEvent>(event, weightedSignersDecoder);
  }
}
