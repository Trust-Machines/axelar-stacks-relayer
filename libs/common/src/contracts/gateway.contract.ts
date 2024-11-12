import { Injectable } from '@nestjs/common';
import {
  ContractCallEvent,
  GatewayExternalData,
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
import { AnchorMode, SignedContractCallOptions, StacksTransaction } from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import { splitContractId } from '../utils/split-contract-id';
import { TransactionsHelper } from './transactions.helper';

@Injectable()
export class GatewayContract {
  private readonly contractAddress;
  private readonly contractName;

  constructor(
    contract: string,
    private readonly network: StacksNetwork,
    private readonly transactionsHelper: TransactionsHelper,
  ) {
    [this.contractAddress, this.contractName] = splitContractId(contract);
  }

  async buildTransactionExternalFunction(
    externalData: GatewayExternalData,
    senderKey: string,
    fee?: bigint,
  ): Promise<StacksTransaction> {
    const opts: SignedContractCallOptions = {
      contractAddress: this.contractAddress,
      contractName: this.contractName,
      functionName: externalData.function,
      functionArgs: [bufferFromHex(externalData.data), bufferFromHex(externalData.proof)],
      senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
    };
    if (fee) {
      opts.fee = fee;
    }
    return await this.transactionsHelper.makeContractCall(opts, fee === undefined);
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
