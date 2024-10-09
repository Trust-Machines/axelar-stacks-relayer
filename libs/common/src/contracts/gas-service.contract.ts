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

@Injectable()
export class GasServiceContract {
  constructor(
    private readonly contract: string,
    private readonly network: StacksNetwork,
  ) {}

  collectFees(sender: string, tokens: string[], amounts: BigNumber[]): Transaction {
    // return this.smartContract.methods
    //   .collectFees([
    //     sender.bech32(),
    //     VariadicValue.fromItemsCounted(...tokens.map((token) => new StringValue(token))),
    //     VariadicValue.fromItemsCounted(...amounts.map((amount) => new BigUIntValue(amount))),
    //   ])
    //   .withGasLimit(GasInfo.CollectFeesBase.value + GasInfo.CollectFeesExtra.value * tokens.length)
    //   .withSender(sender)
    //   .buildTransaction();
    throw new NotImplementedException('Method not implemented yet');
  }

  refund(
    sender: string,
    txHash: string,
    logIndex: string,
    receiver: string,
    token: string,
    amount: string,
  ): Transaction {
    // return this.smartContract.methods
    //   .refund([Buffer.from(txHash, 'hex'), logIndex, receiver, token, amount])
    //   .withGasLimit(GasInfo.Refund.value)
    //   .withSender(sender)
    //   .buildTransaction();
    throw new NotImplementedException('Method not implemented yet');
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
