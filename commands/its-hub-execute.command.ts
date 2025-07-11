import { Command, CommandRunner } from 'nest-commander';
import { ApiConfigService } from '@stacks-monorepo/common';
import { Injectable, Logger } from '@nestjs/common';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { StacksService } from './services/stacks.service';
import { AxelarService } from './services/axelar.service';
import { CONSTANTS } from '@stacks-monorepo/common/utils/constants.enum';
import CallEvent = Components.Schemas.CallEvent;

@Injectable()
@Command({ name: 'its-hub-execute', description: 'Execute a message on ITS Hub' })
export class ItsHubExecuteCommand extends CommandRunner {
  private readonly axelarChainGatewayContract: string;
  private readonly logger: Logger;

  constructor(
    private readonly stackService: StacksService,
    private readonly axelarService: AxelarService,
    apiConfigService: ApiConfigService,
  ) {
    super();

    this.axelarChainGatewayContract = apiConfigService.getAxelarChainGatewayContract();
    this.logger = new Logger(ItsHubExecuteCommand.name);
  }

  async run(passedParam: string[]): Promise<void> {
    if (!passedParam.length || !passedParam[0]) {
      this.logger.error('TxHash is required as first parameter');
      return;
    }

    const txHash = passedParam[0];

    const contractCallEvent = await this.stackService.getStacksCallEvent(txHash);

    if (!contractCallEvent) {
      return;
    }

    await this.sendCosmWasmRequest(contractCallEvent);
  }

  private async sendCosmWasmRequest(callEvent: CallEvent) {
    const message = callEvent.message;
    const request = {
      execute: {
        cc_id: {
          source_chain: CONSTANTS.SOURCE_CHAIN_NAME,
          message_id: message.messageID,
        },
        payload: Buffer.from(callEvent.payload, 'base64').toString('hex'),
      },
    };

    this.logger.debug('Sending CosmWasm request', request);

    const wallet = await this.axelarService.getCosmWasmWallet();
    const client = await this.axelarService.getCosmWasmClient(wallet);
    const [account] = await wallet.getAccounts();

    const tx = await client.execute(account.address, this.axelarChainGatewayContract, request, 'auto');

    this.logger.debug(`Sent verify transaction to CosmWasm Gateway contract, txHash ${tx.transactionHash}`, tx);
  }
}
