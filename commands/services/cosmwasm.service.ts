import { Injectable, Logger } from '@nestjs/common';
import { Components, ConstructProofTask, WasmRequest } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import { SlackApi } from '@stacks-monorepo/common/api/slack.api';
import VerifyTask = Components.Schemas.VerifyTask;

@Injectable()
export class CosmwasmService {
  private readonly logger: Logger;

  private readonly axelarContractIts: string;
  private readonly stacksContractItsProxy: string;

  constructor(private readonly slackApi: SlackApi) {
    this.axelarContractIts = apiConfigService.getAxelarContractIts();
    this.stacksContractItsProxy = apiConfigService.getContractItsProxy();

    this.logger = new Logger(CosmwasmService.name);
  }

  async buildConstructProofRequest(task: ConstructProofTask): Promise<WasmRequest | null> {
    // Handle ITS Hub -> Stacks ITS case
    if (task.message.sourceAddress === this.axelarContractIts && task.message.sourceChain === CONSTANTS.AXELAR_CHAIN) {
      return {
        construct_proof_with_payload: [
          {
            message_id: { source_chain: task.message.sourceChain, message_id: task.message.messageID },
            payload: Buffer.from(task.payload, 'base64').toString('hex'),
          },
        ],
      };
    }

    this.logger.error(
      `Currently only ITS is supported for Stacks, can not construct proof for message ${task.message.messageID}`,
      task,
    );
    await this.slackApi.sendWarn(
      'Currently only ITS is supported for Stacks',
      `Can not construct proof for message ${task.message.messageID}`,
    );

    return null;
  }

  async buildVerifyRequest(task: VerifyTask): Promise<Components.Schemas.WasmRequest | null> {
    const payloadHash = Buffer.from(task.message.payloadHash, 'base64').toString('hex');

    // Handle Stacks ITS -> ITS Hub case
    if (
      task.message.sourceAddress === this.stacksContractItsProxy &&
      task.message.destinationAddress === this.axelarContractIts &&
      task.destinationChain === CONSTANTS.AXELAR_CHAIN
    ) {
      return {
        verify_message_with_payload: [
          {
            message: {
              cc_id: { source_chain: task.message.sourceChain, message_id: task.message.messageID },
              destination_chain: CONSTANTS.AXELAR_CHAIN,
              destination_address: task.message.destinationAddress,
              source_address: task.message.sourceAddress,
              payload_hash: payloadHash,
            },
            payload: Buffer.from(task.payload, 'base64').toString('hex'),
          },
        ],
      };
    }

    this.logger.error(
      `Currently only ITS is supported for Stacks, can not verify message ${task.message.messageID}`,
      task,
    );
    await this.slackApi.sendWarn(
      'Currently only ITS is supported for Stacks',
      `Can not verify message ${task.message.messageID}`,
    );

    return null;
  }
}
