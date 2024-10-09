import { Interaction } from '@multiversx/sdk-core/out';
import { Injectable, NotImplementedException } from '@nestjs/common';
import { StacksNetwork } from '@stacks/network';

const MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN = 1;

const DEFAULT_ESDT_ISSUE_COST = '50000000000000000'; // 0.05 EGLD

@Injectable()
export class ItsContract {
  constructor(
    private readonly contract: string,
    private readonly network: StacksNetwork,
  ) {}

  execute(
    sourceChain: string,
    messageId: string,
    sourceAddress: string,
    payload: Buffer,
    executedTimes: number,
  ): Interaction {
    // const messageType = this.decodeExecutePayloadMessageType(payload);

    // const interaction = this.smartContract.methods.execute([sourceChain, messageId, sourceAddress, payload]);

    // // The second time this transaction is executed it needs to contain and EGLD transfer for issuing ESDT
    // if (messageType === MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN && executedTimes === 1) {
    //   interaction.withValue(TokenTransfer.egldFromBigInteger(DEFAULT_ESDT_ISSUE_COST));
    // }

    // return interaction;
    throw new NotImplementedException('Method not implemented');
  }

  private decodeExecutePayloadMessageType(payload: Buffer): number {
    // const result = AbiCoder.defaultAbiCoder().decode(['uint256'], payload);

    // return Number(result[0]);
    throw new NotImplementedException('Method not implemented');
  }
}
