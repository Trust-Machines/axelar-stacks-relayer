import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  GasAddedEvent,
  GasPaidForContractCallEvent,
  RefundedEvent,
} from '@stacks-monorepo/common/contracts/entities/gas-service-events';
import { StacksNetwork } from '@stacks/network';
import {
  AnchorMode,
  callReadOnlyFunction,
  createSTXPostCondition,
  cvToString,
  FungibleConditionCode,
  principalCV,
  StacksTransaction,
  uintCV,
} from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { ScEvent } from '@stacks-monorepo/common/utils';
import {
  DecodingUtils,
  gasAddedDecoder,
  gasPaidForContractCallDecoder,
  refundedDecoder,
} from '../utils/decoding.utils';
import { splitContractId } from '../utils/split-contract-id';
import { TransactionsHelper } from './transactions.helper';

@Injectable()
export class GasServiceContract implements OnModuleInit {
  private readonly proxyContractAddress;
  private readonly proxyContractName;
  private gasImpl?: string;

  constructor(
    proxyContractId: string,
    private readonly storageContractId: string,
    private readonly network: StacksNetwork,
    private readonly transactionsHelper: TransactionsHelper,
  ) {
    [this.proxyContractAddress, this.proxyContractName] = splitContractId(proxyContractId);
  }

  async onModuleInit() {
    await this.getGasImpl();
  }

  async getGasImpl(): Promise<string> {
    if (this.gasImpl) {
      return this.gasImpl;
    }

    const [storageContractAddress, storageContractName] = splitContractId(this.storageContractId);

    const result = await callReadOnlyFunction({
      contractAddress: storageContractAddress,
      contractName: storageContractName,
      functionName: 'get-impl',
      functionArgs: [],
      network: this.network,
      senderAddress: storageContractAddress,
    });

    this.gasImpl = cvToString(result);

    return this.gasImpl;
  }

  async refund(
    sender: string,
    gasImpl: string,
    txHash: string,
    logIndex: string,
    receiver: string,
    amount: string,
  ): Promise<StacksTransaction> {
    const postCondition = createSTXPostCondition(gasImpl, FungibleConditionCode.LessEqual, amount);

    return await this.transactionsHelper.makeContractCall({
      contractAddress: this.proxyContractAddress,
      contractName: this.proxyContractName,
      functionName: 'refund',
      functionArgs: [
        principalCV(gasImpl),
        bufferFromHex(txHash),
        uintCV(logIndex),
        principalCV(receiver),
        uintCV(amount),
      ],
      senderKey: sender,
      network: this.network,
      anchorMode: AnchorMode.Any,
      postConditions: [postCondition],
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
}
