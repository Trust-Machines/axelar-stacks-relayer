import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
import {
  AnchorMode,
  callReadOnlyFunction,
  cvToString,
  principalCV,
  SignedContractCallOptions,
} from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import { splitContractId } from '../utils/split-contract-id';
import { TransactionsHelper } from './transactions.helper';

@Injectable()
export class GatewayContract implements OnModuleInit {
  private logger: Logger;
  private readonly contractAddress;
  private readonly contractName;
  private gatewayImpl?: string;

  constructor(
    proxyContract: string,
    private readonly storageContract: string,
    private readonly network: StacksNetwork,
    private readonly transactionsHelper: TransactionsHelper,
  ) {
    this.logger = new Logger(GatewayContract.name);
    [this.contractAddress, this.contractName] = splitContractId(proxyContract);
  }

  async onModuleInit() {
    await this.getGatewayImpl();
  }

  async getGatewayImpl(): Promise<string> {
    if (this.gatewayImpl) {
      return this.gatewayImpl;
    }

    const [storageContractAddress, storageContractName] = splitContractId(this.storageContract);

    const result = await callReadOnlyFunction({
      contractAddress: storageContractAddress,
      contractName: storageContractName,
      functionName: 'get-impl',
      functionArgs: [],
      network: this.network,
      senderAddress: storageContractAddress,
    });

    this.gatewayImpl = cvToString(result);
    return this.gatewayImpl;
  }

  async buildTransactionExternalFunction(
    externalData: GatewayExternalData,
    senderKey: string,
    fee?: bigint,
  ) {
    const gatewayImpl = await this.getGatewayImpl();

    const opts: SignedContractCallOptions = {
      contractAddress: this.contractAddress,
      contractName: this.contractName,
      functionName: externalData.function,
      functionArgs: [principalCV(gatewayImpl), bufferFromHex(externalData.data), bufferFromHex(externalData.proof)],
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
