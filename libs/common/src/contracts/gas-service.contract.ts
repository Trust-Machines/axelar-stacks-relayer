import { Injectable } from '@nestjs/common';
import {
  GasAddedEvent,
  GasPaidForContractCallEvent,
  RefundedEvent,
} from '@stacks-monorepo/common/contracts/entities/gas-service-events';
import { StacksNetwork } from '@stacks/network';
import {
  AnchorMode,
  bufferCVFromString,
  listCV,
  makeContractCall,
  principalCV,
  StacksTransaction,
  uintCV,
} from '@stacks/transactions';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import BigNumber from 'bignumber.js';
import {
  DecodingUtils,
  gasAddedDecoder,
  gasPaidForContractCallDecoder,
  refundedDecoder,
} from '../utils/decoding.utils';
import { bufferFromHex } from '@stacks/transactions/dist/cl';

@Injectable()
export class GasServiceContract {
  constructor(
    private readonly contract: string,
    private readonly contractName: string,
    private readonly network: StacksNetwork,
  ) {}

  async collectFees(sender: string, receiver: string, amount: string): Promise<StacksTransaction> {
    return await makeContractCall({
      contractAddress: this.contract,
      contractName: this.contractName,
      functionName: 'collectFees',
      functionArgs: [principalCV(receiver), uintCV(amount)],
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
    amount: string,
  ): Promise<StacksTransaction> {
    return await makeContractCall({
      contractAddress: this.contract,
      contractName: this.contractName,
      functionName: 'refund',
      functionArgs: [
        bufferFromHex(Buffer.from(txHash, 'hex').toString()),
        uintCV(logIndex),
        principalCV(receiver),
        uintCV(amount),
      ],
      senderKey: sender,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });
  }

  decodeNativeGasPaidForContractCallEvent(event: ScEvent): GasPaidForContractCallEvent {
    return DecodingUtils.decodeEvent<GasPaidForContractCallEvent>(event, gasPaidForContractCallDecoder);
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
