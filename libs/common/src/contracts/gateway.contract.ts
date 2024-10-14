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
import { AnchorMode, makeContractCall, StacksTransaction } from '@stacks/transactions';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';

@Injectable()
export class GatewayContract {
  constructor(
    private readonly contract: string,
    private readonly contractName: string,
    private readonly network: StacksNetwork,
  ) {}

  async buildTransactionExternalFunction(externalData: string, senderKey: string): Promise<StacksTransaction> {
    return await makeContractCall({
      contractAddress: this.contract,
      contractName: this.contractName,
      functionName: 'TODO',
      functionArgs: [],
      senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });
    // TODO: implement Stacks transaction function name and function args
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
