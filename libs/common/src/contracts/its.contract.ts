import { Injectable, NotImplementedException } from '@nestjs/common';
import { StacksNetwork } from '@stacks/network';
import { AnchorMode, bufferCV, makeContractCall, StacksTransaction } from '@stacks/transactions';
import { bufferFromHex } from '@stacks/transactions/dist/cl';
import { BinaryUtils } from '../utils';

const MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN = 1;

const DEFAULT_ESDT_ISSUE_COST = '50000000000000000'; // 0.05 EGLD

@Injectable()
export class ItsContract {
  constructor(
    private readonly contract: string,
    private readonly contractName: string,
    private readonly network: StacksNetwork,
  ) {}

  async execute(
    senderKey: string,
    sourceChain: string,
    messageId: string,
    sourceAddress: string,
    payload: Buffer,
    executedTimes: number,
  ): Promise<StacksTransaction> {
    // const messageType = this.decodeExecutePayloadMessageType(payload);

    // const interaction = this.smartContract.methods.execute([sourceChain, messageId, sourceAddress, payload]);

    // // The second time this transaction is executed it needs to contain and EGLD transfer for issuing ESDT
    // if (messageType === MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN && executedTimes === 1) {
    //   interaction.withValue(TokenTransfer.egldFromBigInteger(DEFAULT_ESDT_ISSUE_COST));
    // }

    // return interaction;
    return await makeContractCall({
      contractAddress: this.contract,
      contractName: this.contractName,
      functionName: 'execute',
      functionArgs: [
        bufferFromHex(BinaryUtils.stringToHex(sourceChain)),
        bufferFromHex(BinaryUtils.stringToHex(messageId)),
        bufferFromHex(BinaryUtils.stringToHex(sourceAddress)),
        bufferCV(payload),
      ],
      senderKey: senderKey,
      network: this.network,
      anchorMode: AnchorMode.Any,
    });
  }

  private decodeExecutePayloadMessageType(payload: Buffer): number {
    // const result = AbiCoder.defaultAbiCoder().decode(['uint256'], payload);

    // return Number(result[0]);
    throw new NotImplementedException('Method not implemented');
  }
}
