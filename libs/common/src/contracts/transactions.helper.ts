import { Inject, Injectable, Logger } from '@nestjs/common';
import { Transaction } from '@stacks/blockchain-api-client/src/types';
import { StacksNetwork } from '@stacks/network';
import {
  broadcastTransaction,
  estimateContractDeploy,
  estimateContractFunctionCall,
  getAddressFromPrivateKey,
  makeContractCall,
  makeContractDeploy,
  SignedContractCallOptions,
  SignedContractDeployOptions,
  StacksTransaction,
  TransactionVersion,
} from '@stacks/transactions';
import { HiroApiHelper } from '../helpers/hiro.api.helpers';
import { RedisHelper } from '../helpers/redis.helper';
import { CacheInfo } from '../utils';
import { ProviderKeys } from '../utils/provider.enum';
import { GasError } from './entities/gas.error';
import { awaitSuccess, delay } from '../utils/await-success';
import { TooLowAvailableBalanceError } from './entities/too-low-available-balance.error';
import { ApiConfigService } from '../config';
import { GasCheckerPayload } from './entities/gas-checker-payload';

const TX_TIMEOUT_MILLIS = 600_000;
const TX_POLL_INTERVAL = 6000;

@Injectable()
export class TransactionsHelper {
  private readonly logger: Logger;
  private readonly walletSignerAddress;
  private readonly availableGasCheckEnabled: boolean;

  constructor(
    private readonly hiroApiHelper: HiroApiHelper,
    private readonly redisHelper: RedisHelper,
    @Inject(ProviderKeys.WALLET_SIGNER) walletSigner: string,
    @Inject(ProviderKeys.STACKS_NETWORK) network: StacksNetwork,
    apiConfigService: ApiConfigService,
  ) {
    this.logger = new Logger(TransactionsHelper.name);

    this.walletSignerAddress = getAddressFromPrivateKey(
      walletSigner,
      network.isMainnet() ? TransactionVersion.Mainnet : TransactionVersion.Testnet,
    );

    this.availableGasCheckEnabled = apiConfigService.getAvailableGasCheckEnabled();
  }

  async getTransactionGas(transaction: StacksTransaction, retry: number, network: StacksNetwork): Promise<bigint> {
    const result = await estimateContractFunctionCall(transaction, network);

    if (!result) {
      throw new GasError(`Could not get gas for transaction ${transaction.txid()} ${JSON.stringify(result)}`);
    }

    // add 10% extra gas initially, and more gas with each retry
    const extraGasPercent = 10 + retry * 2;
    const extraGas = (result * BigInt(extraGasPercent)) / BigInt(100);

    return result + extraGas;
  }

  async sendTransaction(transaction: StacksTransaction): Promise<string> {
    try {
      const broadcastResponse = await broadcastTransaction(transaction);
      if (broadcastResponse.error) {
        await this.decrementNonce();
        throw new Error(`Could not broadcast tx ${JSON.stringify(broadcastResponse)}`);
      }
      return broadcastResponse.txid;
    } catch (e) {
      await this.decrementNonce();

      this.logger.error('Could not send transaction');
      this.logger.error(e);

      throw e;
    }
  }

  async makeContractCall(opts: SignedContractCallOptions, simulate: boolean = false) {
    if (simulate) {
      return await makeContractCall(opts);
    }

    try {
      const nonce = await this.getSignerNonce();
      this.logger.debug(`Calling makeContractCall with nonce: ${nonce}`);

      return await makeContractCall({ ...opts, nonce });
    } catch (e) {
      await this.decrementNonce();

      this.logger.error('Could not call makeContractCall');
      this.logger.error(e);

      throw e;
    }
  }

  async makeContractDeploy(opts: SignedContractDeployOptions) {
    try {
      const nonce = await this.getSignerNonce();
      this.logger.debug(`Calling makeContractDeploy with nonce: ${nonce}`);

      return await makeContractDeploy({ ...opts, nonce });
    } catch (e) {
      await this.decrementNonce();

      this.logger.error('Could not call makeContractDeploy');
      this.logger.error(e);

      throw e;
    }
  }

  async sendTransactions(transactions: StacksTransaction[]) {
    if (!transactions.length) {
      return [];
    }

    const hashes: string[] = [];

    for (const tx of transactions) {
      try {
        const hash = await this.sendTransaction(tx);
        hashes.push(hash);
        this.logger.log(`Transaction ${tx.txid()} sent successfully`);
      } catch (error) {
        this.logger.error(`Transaction ${tx.txid()} could not be sent`);
        this.logger.error(error);
      }
    }

    this.logger.log(`Sent ${hashes.length}/${transactions.length} transactions successfully`);
    return hashes;
  }

  async awaitSuccess(txHash: string): Promise<{ success: boolean; transaction: Transaction | null }> {
    await delay(300); // If we try to get the txStatus immediately after broadcasting the tx, we might get 404
    const { result } = await awaitSuccess<Transaction>(
      txHash,
      TX_TIMEOUT_MILLIS,
      TX_POLL_INTERVAL,
      `TRANSACTION_STATUS:${txHash}`,
      async (hash) => await this.hiroApiHelper.getTransaction(hash),
      (tx: Transaction) => (tx.tx_status as any) !== 'pending',
      this.logger,
    );

    const successful = result?.tx_status === 'success';
    if (!successful) {
      return { success: false, transaction: null };
    }

    return { success: true, transaction: result };
  }

  private async getSignerNonce(): Promise<number> {
    const value = await this.getCachedNonce();
    this.logger.debug(`Cached last used nonce: ${value}`);

    if (!value) {
      const nextNonce = await this.getNextSignerNonce();
      this.logger.debug(`Next nonce retrieved from API: ${nextNonce}`);

      await this.setSignerNonce(nextNonce);

      return nextNonce;
    }

    return await this.incrementNonce();
  }

  async getNextSignerNonce(): Promise<number> {
    const nonce = await this.hiroApiHelper.getNextNonce(this.walletSignerAddress);
    if (!nonce) {
      throw new Error(`Could not fetch next nonce for address '${this.walletSignerAddress}'`);
    }

    return nonce;
  }

  async setSignerNonce(nonce: number) {
    await this.redisHelper.set(
      CacheInfo.WalletNonce(this.walletSignerAddress).key,
      nonce,
      CacheInfo.WalletNonce(this.walletSignerAddress).ttl,
    );
  }

  async getCachedNonce(): Promise<number | undefined> {
    return await this.redisHelper.get(CacheInfo.WalletNonce(this.walletSignerAddress).key);
  }

  async incrementNonce(): Promise<number> {
    return await this.redisHelper.incrby(CacheInfo.WalletNonce(this.walletSignerAddress).key, 1);
  }

  async decrementNonce(): Promise<number> {
    return await this.redisHelper.decrby(CacheInfo.WalletNonce(this.walletSignerAddress).key, 1);
  }

  getWalletSignerAddress(): string {
    return this.walletSignerAddress;
  }

  async checkAvailableGasBalance(
    messageId: string,
    availableGasBalance: string,
    transactions: GasCheckerPayload[],
  ): Promise<boolean> {
    this.logger.debug(
      `[messageId: ${messageId}] Checking available gas balance: availableGasBalance: ${availableGasBalance}`,
    );
    const availableBalance: bigint = BigInt(availableGasBalance);

    let totalEstimatedFees = 0n;

    for (const { transaction, deployContract = false } of transactions) {
      let estimatedFee: bigint;

      if (deployContract) {
        estimatedFee = await estimateContractDeploy(transaction);
      } else {
        estimatedFee = await estimateContractFunctionCall(transaction);
      }

      totalEstimatedFees += estimatedFee;
    }

    if (!this.availableGasCheckEnabled) {
      this.logger.warn(
        `[messageId: ${messageId}] Not enough gas paid: availableGasBalance: ${availableBalance}, totalEstimatedBalance: ${totalEstimatedFees}, but the gas checker is disabled`,
      );
      return true;
    }

    if (availableBalance < totalEstimatedFees) {
      this.logger.error(
        `[messageId: ${messageId}] Not enough gas paid: availableGasBalance: ${availableBalance}, totalEstimatedBalance: ${totalEstimatedFees}. `,
      );
      throw new TooLowAvailableBalanceError();
    }

    this.logger.debug(
      `[messageId: ${messageId}] Enough gas was paid: availableGasBalance: ${availableBalance}, totalEstimatedBalance: ${totalEstimatedFees}`,
    );
    return true;
  }
}
