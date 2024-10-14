import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  GasAddedEvent,
  GasPaidForContractCallEvent,
  RefundedEvent,
} from '@stacks-monorepo/common/contracts/entities/gas-service-events';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { StacksNetwork } from '@stacks/network';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import BigNumber from 'bignumber.js';
import {
  DecodingUtils,
  gasAddedDecoder,
  gasPaidForContractCallDecoder,
  refundedDecoder,
} from '../utils/decoding.utils';
import {
  AnchorMode,
  bufferCV,
  bufferCVFromString,
  listCV,
  makeContractCall,
  principalCV,
  StacksTransaction,
} from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { BinaryUtils } from '../utils';

@Injectable()
export class GasServiceContract {
  constructor(
    private readonly contract: string,
    private readonly contractName: string,
    private readonly network: StacksNetwork,
  ) {}

  async collectFees(sender: string, tokens: string[], amounts: BigNumber[]): Promise<StacksTransaction> {
    return await makeContractCall({
      contractAddress: this.contract,
      contractName: this.contractName,
      functionName: 'collectFees',
      functionArgs: [
        listCV([...tokens.map((token) => bufferCVFromString(token))]),
        listCV([...amounts.map((amount) => bufferFromHex(BinaryUtils.stringToHex(amount.toFixed())))]),
      ],
      senderKey: sender,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });
  }

  async refund(
    sender: string,
    txHash: string,
    logIndex: string,
    receiver: string,
    token: string,
    amount: string,
  ): Promise<StacksTransaction> {
    return await makeContractCall({
      contractAddress: this.contract,
      contractName: this.contractName,
      functionName: 'refund',
      functionArgs: [
        bufferFromHex(txHash),
        bufferFromHex(BinaryUtils.stringToHex(logIndex)),
        principalCV(receiver),
        bufferCVFromString(token),
        bufferFromHex(BinaryUtils.stringToHex(amount)),
      ],
      senderKey: sender,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });
  }

  decodeGasPaidForContractCallEvent(event: ScEvent): GasPaidForContractCallEvent {
    return DecodingUtils.decodeEvent<GasPaidForContractCallEvent>(event, gasPaidForContractCallDecoder);
  }

  decodeNativeGasPaidForContractCallEvent(event: ScEvent): GasPaidForContractCallEvent {
    return DecodingUtils.decodeEvent<GasPaidForContractCallEvent>(event, gasPaidForContractCallDecoder);
  }

  decodeGasAddedEvent(event: ScEvent): GasAddedEvent {
    return DecodingUtils.decodeEvent<GasAddedEvent>(event, gasAddedDecoder);
  }

  decodeNativeGasAddedEvent(event: ScEvent): GasAddedEvent {
    return DecodingUtils.decodeEvent<GasAddedEvent>(event, gasAddedDecoder);
  }

  decodeRefundedEvent(event: ScEvent): RefundedEvent {
    return DecodingUtils.decodeEvent<RefundedEvent>(event, refundedDecoder);
  }

  getContractAddress(): string {
    return this.contract;
  }
}
