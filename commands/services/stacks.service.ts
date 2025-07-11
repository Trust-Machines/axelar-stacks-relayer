import { Inject, Injectable, Logger } from '@nestjs/common';
import { HiroApiHelper } from '@stacks-monorepo/common/helpers/hiro.api.helpers';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import {
  ApiConfigService,
  GatewayContract,
  mapRawEventsToSmartContractEvents,
  TransactionsHelper,
} from '@stacks-monorepo/common';
import { Components } from '@stacks-monorepo/common/api/entities/axelar.gmp.api';
import { DecodingUtils, gatewayTxDataDecoder } from '@stacks-monorepo/common/utils/decoding.utils';
import CallEvent = Components.Schemas.CallEvent;
import { ProviderKeys } from '@stacks-monorepo/common/utils/provider.enum';
import { StacksNetwork } from '@stacks/network';
import { ItsContract, ItsExtraData } from '@stacks-monorepo/common/contracts/ITS/its.contract';
import {
  GatewayProcessor
} from '../../apps/stacks-scalable-processors/src/cross-chain-transaction-processor/processors';

@Injectable()
export class StacksService {
  private readonly contractGatewayStorage: string;

  private readonly logger: Logger;

  constructor(
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly gatewayProcessor: GatewayProcessor,
    private readonly gatewayContract: GatewayContract,
    private readonly itsContract: ItsContract,
    private readonly transactionsHelper: TransactionsHelper,
    @Inject(ProviderKeys.WALLET_SIGNER) private readonly walletSigner: string,
    @Inject(ProviderKeys.STACKS_NETWORK) private readonly network: StacksNetwork,
    apiConfigService: ApiConfigService,
  ) {
    this.contractGatewayStorage = apiConfigService.getContractGatewayStorage();

    this.logger = new Logger(StacksService.name);
  }

  async getStacksCallEvent(txHash: string): Promise<CallEvent | undefined> {
    this.logger.debug(`Fetching transaction ${txHash} from blockchain...`);

    try {
      const transaction = await this.hiroApiHelper.getTransaction(txHash);

      if (transaction.tx_status !== 'success') {
        this.logger.error('Transaction was not successful on chain');
        return;
      }

      this.logger.warn(`Successfully retrieved transaction for hash ${txHash}`);

      return await this.handleContractCallEvents(transaction);
    } catch (e) {
      this.logger.error(`Failed to fetch transaction for hash ${txHash}`, e);
      return;
    }
  }

  async executeOnGateway(externalDataHex: string) {
    const data = gatewayTxDataDecoder(DecodingUtils.deserialize(externalDataHex));

    this.logger.debug(`Trying to execute Gateway transaction with externalData:`, data);

    const initialTx = await this.gatewayContract.buildTransactionExternalFunction(data, this.walletSigner);

    const fee = await this.transactionsHelper.getTransactionGas(initialTx, 0, this.network);

    const transaction = await this.gatewayContract.buildTransactionExternalFunction(
      data,
      this.walletSigner,
      BigInt(fee),
    );

    const txHash = await this.transactionsHelper.sendTransaction(transaction);

    this.logger.warn(`Successfully sent transaction to Stacks Gateway with has ${txHash}`);
  }

  async executeOnStacksIts(callEvent: CallEvent, extraData?: ItsExtraData) {
    const message = callEvent.message;
    const result = await this.itsContract.execute(
      this.walletSigner,
      message.sourceChain,
      message.messageID,
      message.sourceAddress,
      message.destinationAddress,
      Buffer.from(callEvent.payload, 'base64').toString('hex'),
      '0',
      null,
      extraData,
    );

    if (!result.transaction) {
      this.logger.error('There has been an error building the transaction');
      return;
    }

    const txHash = await this.transactionsHelper.sendTransaction(result.transaction);

    this.logger.warn(
      `Successfully sent transaction to Stacks Gateway with has ${txHash}, extra data is`,
      result.extraData,
    );
  }

  private async handleContractCallEvents(transaction: Transaction) {
    const events = mapRawEventsToSmartContractEvents(transaction.events);

    let callEvent: CallEvent | undefined;

    for (const [_, rawEvent] of events.entries()) {
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

        callEvent = event as CallEvent;
        break;
      }
    }

    if (!callEvent) {
      this.logger.error('Could not find CONTRACT_CALL event...');
    } else {
      this.logger.debug('Found CONTRACT_CALL event', callEvent);
    }

    return callEvent;
  }
}
