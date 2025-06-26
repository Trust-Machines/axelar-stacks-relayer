import { Command, CommandRunner } from 'nest-commander';
import { ApiConfigService } from '@stacks-monorepo/common';
import { Injectable, Logger } from '@nestjs/common';
import { CosmwasmService } from './services/cosmwasm.service';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { StacksService } from './services/stacks.service';
import { AxelarService } from './services/axelar.service';
import CallEvent = Components.Schemas.CallEvent;

@Injectable()
@Command({ name: 'verify-message', description: 'Verify a message from the source Gateway on Stacks' })
export class VerifyMessageCommand extends CommandRunner {
  private readonly axelarGatewayContract: string;
  private readonly axelarVotingVerifierContract: string;
  private readonly logger: Logger;

  constructor(
    private readonly cosmWasmService: CosmwasmService,
    private readonly stackService: StacksService,
    private readonly axelarService: AxelarService,
    apiConfigService: ApiConfigService,
  ) {
    super();

    this.axelarGatewayContract = apiConfigService.getAxelarGatewayContract();
    this.axelarVotingVerifierContract = apiConfigService.getAxelarVotingVerifierContract();
    this.logger = new Logger(VerifyMessageCommand.name);
  }

  async run(passedParam: string[]): Promise<void> {
    if (!passedParam.length || !passedParam[0]) {
      this.logger.error('TxHash is required as first parameter');
      return;
    }

    const txHash = passedParam[0];

    const callEvent = await this.stackService.getStacksCallEvent(txHash);

    if (!callEvent) {
      return;
    }

    await this.sendCosmWasmRequest(callEvent);
  }

  private async sendCosmWasmRequest(callEvent: CallEvent) {
    const message = callEvent.message;
    const request = await this.cosmWasmService.buildVerifyRequest({
      message,
      payload: callEvent.payload,
      destinationChain: callEvent.destinationChain,
    });

    this.logger.debug('Sending CosmWasm request', request);

    const wallet = await this.axelarService.getCosmWasmWallet();
    const client = await this.axelarService.getCosmWasmClient(wallet);
    const [account] = await wallet.getAccounts();

    const tx = await client.execute(account.address, this.axelarGatewayContract, request, 'auto');

    this.logger.warn(`Successfully sent verify transaction to CosmWasm Gateway contract, txHash ${tx.transactionHash}`);

    let status = 'pending';
    do {
      await new Promise((resolve) => setTimeout(resolve, 6000));

      this.logger.debug('Checking if message was approved');

      const payloadHash = Buffer.from(message.payloadHash, 'base64').toString('hex');
      const queryResult = await client.queryContractSmart(this.axelarVotingVerifierContract, {
        messages_status: [
          {
            cc_id: {
              source_chain: message.sourceChain,
              message_id: message.messageID,
            },
            destination_chain: callEvent.destinationChain,
            destination_address: message.destinationAddress,
            source_address: message.sourceAddress,
            payload_hash: payloadHash,
          },
        ],
      });

      status = queryResult?.[0]?.status || 'pending';
    } while (status === 'pending');

    if (status === 'succeeded_on_source_chain') {
      this.logger.warn(`Successfully verified message in Stacks Voting Verifier`);
    } else {
      this.logger.error(`Could not verify message, Stacks Voting Verifier message status is "${status}"`);
    }
  }
}
