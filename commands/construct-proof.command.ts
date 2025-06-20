import { Command, CommandRunner } from 'nest-commander';
import { ApiConfigService } from '@stacks-monorepo/common';
import { Injectable, Logger } from '@nestjs/common';
import { CosmwasmService } from '../apps/axelar-event-processor/src/approvals-processor/cosmwasm.service';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { StacksService } from './services/stacks.service';
import { AxelarService } from './services/axelar.service';
import CallEvent = Components.Schemas.CallEvent;

@Injectable()
@Command({ name: 'construct-proof', description: 'Construct proof for an ITS Hub payload towards Stacks' })
export class ConstructProofCommand extends CommandRunner {
  private readonly axelarMultisigProver: string;
  private readonly logger: Logger;

  constructor(
    private readonly cosmWasmService: CosmwasmService,
    private readonly stackService: StacksService,
    private readonly axelarService: AxelarService,
    apiConfigService: ApiConfigService,
  ) {
    super();

    this.axelarMultisigProver = apiConfigService.getAxelarMultisigProverContract();
    this.logger = new Logger(ConstructProofCommand.name);
  }

  async run(passedParam: string[]): Promise<void> {
    if (!passedParam.length || !passedParam[0]) {
      this.logger.error('TxHash is required as first parameter');
      return;
    }

    const txHash = passedParam[0];

    const axelarCallEvent = await this.axelarService.getAxelarCallEvent(txHash);

    if (!axelarCallEvent) {
      return;
    }

    await this.sendCosmWasmRequest(axelarCallEvent);
  }

  private async sendCosmWasmRequest(axelarCallEvent: CallEvent) {
    const message = axelarCallEvent.message;
    const request = await this.cosmWasmService.buildConstructProofRequest({
      message,
      payload: axelarCallEvent.payload,
    });

    this.logger.debug('Sending CosmWasm request', request);

    const wallet = await this.axelarService.getCosmWasmWallet();
    const client = await this.axelarService.getCosmWasmClient(wallet);
    const [account] = await wallet.getAccounts();

    const tx = await client.execute(account.address, this.axelarMultisigProver, request, 'auto');

    this.logger.warn(`Successfully sent construct proof transaction to CosmWasm Gateway contract, txHash ${tx.transactionHash}`);

    const sessionId = await this.axelarService.getSessionIdFromConstructProofTx(tx);

    let status = undefined;
    do {
      await new Promise((resolve) => setTimeout(resolve, 6000));

      this.logger.debug('Checking if proof was constructed');

      const queryResult = await client.queryContractSmart(this.axelarMultisigProver, {
        proof: {
          multisig_session_id: sessionId,
        },
      });

      if (!queryResult?.status) {
        status = undefined;
        continue;
      }

      status = queryResult.status;
    } while (status === undefined || status === 'pending');

    if (status?.completed?.execute_data) {
      this.logger.warn(`Successfully constructed proof in Stacks Multisig Prover`);

      await this.stackService.executeOnGateway(status.completed.execute_data);
    } else {
      this.logger.error('Could not construct proof, Stacks Multisig Prover status is:', status);
    }
  }
}
