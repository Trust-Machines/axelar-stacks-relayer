import { Command, CommandRunner } from 'nest-commander';
import { ApiConfigService, mapRawEventsToSmartContractEvents } from '@stacks-monorepo/common';
import { Injectable, Logger } from '@nestjs/common';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { GatewayProcessor } from '../apps/stacks-event-processor/src/cross-chain-transaction-processor/processors';
import { CosmwasmService } from '../apps/axelar-event-processor/src/approvals-processor/cosmwasm.service';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import CallEvent = Components.Schemas.CallEvent;

interface VerifyMessageOptions {}

@Injectable()
@Command({ name: 'verify-message', description: 'Verify a message from the source Gateway on Stacks' })
export class VerifyMessageCommand extends CommandRunner {
  private readonly contractGatewayStorage: string;
  private readonly axelarGatewayContract: string;
  private readonly axelarVotingVerifierContract: string;
  private readonly logger: Logger;

  constructor(
    private readonly apiConfigService: ApiConfigService,
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly gatewayProcessor: GatewayProcessor,
    private readonly cosmWasmService: CosmwasmService,
  ) {
    super();

    this.contractGatewayStorage = apiConfigService.getContractGatewayStorage();
    this.axelarGatewayContract = apiConfigService.getAxelarGatewayContract();
    this.axelarVotingVerifierContract = apiConfigService.getAxelarVotingVerifierContract();
    this.logger = new Logger(VerifyMessageCommand.name);
  }

  async run(passedParam: string[], options?: VerifyMessageOptions): Promise<void> {
    if (!passedParam.length || !passedParam[0]) {
      this.logger.error('TxHash is required as first parameter');
      return;
    }

    const txHash = passedParam[0];

    this.logger.debug(`Fetching transaction ${txHash} from blockchain...`);

    try {
      const transaction = await this.hiroApiHelper.getTransaction(txHash);

      if (transaction.tx_status !== 'success') {
        this.logger.error('Transaction was not succesfull on chain');
        return;
      }

      this.logger.warn(`Successfully retrieved transaction for hash ${txHash}`);

      const contractCallEvent = await this.handleContractCallEvents(transaction);

      if (contractCallEvent) {
        await this.sendCosmWasmRequest(contractCallEvent);
      }
    } catch (e) {
      this.logger.error(`Failed to fetch transaction for hash ${txHash}`, e);
      return;
    }
  }

  private async handleContractCallEvents(transaction: Transaction) {
    const events = mapRawEventsToSmartContractEvents(transaction.events);

    let contractCallEvent: CallEvent | null = null;

    for (const [index, rawEvent] of events.entries()) {
      const address = rawEvent.contract_log.contract_id;
      let transferAmount = '0';
      if (transaction.tx_type === 'token_transfer') {
        transferAmount = transaction.token_transfer.amount;
      }

      if (address === this.contractGatewayStorage) {
        const event = await this.gatewayProcessor.handleGatewayEvent(
          rawEvent,
          transaction,
          rawEvent.event_index,
          '0',
          transferAmount,
        );

        if (!event || event.type !== 'CALL') {
          this.logger.error('Invalid event found');
          return;
        }

        contractCallEvent = event as CallEvent;
        break;
      }
    }

    if (!contractCallEvent) {
      this.logger.error('Could not find CONTRACT_CALL event...');
    } else {
      this.logger.debug('Found CONTRACT_CALL event', contractCallEvent);
    }

    return contractCallEvent;
  }

  private async sendCosmWasmRequest(contractCallEvent: CallEvent) {
    const message = contractCallEvent.message;
    const request = this.cosmWasmService.buildVerifyRequest({
      message,
      payload: contractCallEvent.payload,
      destinationChain: contractCallEvent.destinationChain,
    });

    this.logger.debug('Sending CosmWasm request', request);

    const wallet = await this.getCosmWasmWallet();
    const client = await this.getCosmWasmClient(wallet);
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
            destination_chain: contractCallEvent.destinationChain,
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

  private async getCosmWasmWallet() {
    return await DirectSecp256k1HdWallet.fromMnemonic(this.apiConfigService.getAxelarMnemonic(), { prefix: 'axelar' });
  }

  private async getCosmWasmClient(wallet: DirectSecp256k1HdWallet) {
    const gasPrice = GasPrice.fromString(this.apiConfigService.getAxelarGasPrice());

    return await SigningCosmWasmClient.connectWithSigner(this.apiConfigService.getAxelarRpcUrl(), wallet, { gasPrice });
  }
}
