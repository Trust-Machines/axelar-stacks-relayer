import { Injectable } from '@nestjs/common';
import {
  GasAddedEvent,
  GasPaidForContractCallEvent,
  RefundedEvent,
} from '@stacks-monorepo/common/contracts/entities/gas-service-events';
import { StacksNetwork } from '@stacks/network';
import { AnchorMode, principalCV, StacksTransaction, uintCV } from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import {
  DecodingUtils,
  gasAddedDecoder,
  gasPaidForContractCallDecoder,
  refundedDecoder,
} from '../utils/decoding.utils';
import { splitContractId } from '../utils/split-contract-id';
import { TransactionsHelper } from './transactions.helper';

@Injectable()
export class GasServiceContract {
  private readonly contractAddress;
  private readonly contractName;

  constructor(
    private readonly contract: string,
    private readonly network: StacksNetwork,
    private readonly transactionsHelper: TransactionsHelper,
  ) {
    [this.contractAddress, this.contractName] = splitContractId(contract);
  }

  async collectFees(sender: string, receiver: string, amount: string): Promise<StacksTransaction> {
    return await this.transactionsHelper.makeContractCall({
      contractAddress: this.contractAddress,
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
    return await this.transactionsHelper.makeContractCall({
      contractAddress: this.contractAddress,
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
