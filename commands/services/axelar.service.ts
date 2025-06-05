import { Injectable, Logger } from '@nestjs/common';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice, IndexedTx } from '@cosmjs/stargate';
import { ExecuteResult, SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { ApiConfigService } from '@stacks-monorepo/common';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import CallEvent = Components.Schemas.CallEvent;
import { Attribute } from '@cosmjs/stargate/build/events';

@Injectable()
export class AxelarService {
  private readonly logger: Logger;

  constructor(private readonly apiConfigService: ApiConfigService) {
    this.logger = new Logger(AxelarService.name);
  }

  async getCosmWasmWallet() {
    return await DirectSecp256k1HdWallet.fromMnemonic(this.apiConfigService.getAxelarMnemonic(), { prefix: 'axelar' });
  }

  async getCosmWasmClient(wallet: DirectSecp256k1HdWallet) {
    const gasPrice = GasPrice.fromString(this.apiConfigService.getAxelarGasPrice());

    return await SigningCosmWasmClient.connectWithSigner(this.apiConfigService.getAxelarRpcUrl(), wallet, { gasPrice });
  }

  async getAxelarCallEvent(txHash: string): Promise<CallEvent | undefined> {
    const wallet = await this.getCosmWasmWallet();
    const client = await this.getCosmWasmClient(wallet);

    try {
    const transaction = await client.getTx(txHash);

    if (!transaction) {
      this.logger.error('Axelar transaction was not successful on chain');
      return;
    }

    this.logger.warn(`Successfully retrieved Axelar transaction for hash ${txHash}`);

    return this.handleEvents(transaction);
    } catch (e) {
      this.logger.error(`Failed to fetch Axelar transaction for hash ${txHash}`, e);
      return;
    }
  }

  getSessionIdFromConstructProofTx(transaction: ExecuteResult) {
    for (const event of transaction.events) {
      if (event.type === 'wasm-signing_started') {
        const sessionId = this.findAttribute(event.attributes, 'session_id');

        this.logger.debug(`Found wasm-signing_started event, session id is ${sessionId}`);

        return sessionId;
      }
    }

    this.logger.error('Could not find wasm-signing_started event...');

    return;
  }

  private handleEvents(transaction: IndexedTx) {
    let callEvent: CallEvent | undefined;
    for (const event of transaction.events) {
      if (event.type === 'wasm-contract_called') {
        callEvent = {
          eventID: this.findAttribute(event.attributes, 'message_id'),
          message: {
            messageID: this.findAttribute(event.attributes, 'message_id'),
            sourceChain: this.findAttribute(event.attributes, 'source_chain'),
            sourceAddress: this.findAttribute(event.attributes, 'source_address'),
            destinationAddress: this.findAttribute(event.attributes, 'destination_address'),
            payloadHash: Buffer.from(this.findAttribute(event.attributes, 'payload_hash'), 'hex').toString('base64'),
          },
          destinationChain: this.findAttribute(event.attributes, 'destination_chain'),
          payload: Buffer.from(this.findAttribute(event.attributes, 'payload'), 'hex').toString('base64'),
        };
        break;
      }
    }

    if (!callEvent) {
      this.logger.error('Could not find wasm-contract_called event...');
    } else {
      this.logger.debug('Found wasm-contract_called event', callEvent);
    }

    return callEvent;
  }

  private findAttribute(attributes: readonly Attribute[], property: string) {
    return attributes.find((attribute) => attribute.key === property)?.value || '';
  }
}
