import { Injectable } from '@nestjs/common';
import { OperationResponse, Transaction } from '@stacks/blockchain-api-client/src/types';
import axios, { AxiosInstance } from 'axios';
import { ApiConfigService } from '../config';
import { mapRawEventsToSmartContractEvents } from '../utils';
import { ScEvent } from 'apps/stacks-event-processor/src/event-processor/types';
import { deserializeTransaction, StacksTransaction } from '@stacks/transactions';

export type AddressBalanceResponse = OperationResponse['get_account_balance']; // This is missing from the SDK so we import it manually

export type ContractInfoResponse = {
  tx_id: string;
  canonical: boolean;
  contract_id: string;
  block_height: number;
  clarity_version: number;
  source_code: string;
  abi: any;
};

const API_TIMEOUT = 30_000; // 30 seconds

@Injectable()
export class HiroApiHelper {
  private readonly client: AxiosInstance;

  constructor(apiConfigService: ApiConfigService) {
    this.client = axios.create({
      baseURL: apiConfigService.getHiroApiUrl(),
      timeout: API_TIMEOUT,
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiConfigService.getHiroApiKey(),
      },
    });
  }

  async getTransactionWithFee(txHash: string): Promise<{ transaction: Transaction; fee: string }> {
    const response = await this.client.get(`/extended/v1/tx/${txHash}`);
    const transaction = response.data as Transaction;

    return { transaction, fee: transaction.fee_rate };
  }

  async getTransaction(txHash: string): Promise<Transaction> {
    const response = await this.client.get(`/extended/v1/tx/${txHash}`);

    return response.data as Transaction;
  }

  async getTransactionRaw(txId: string): Promise<StacksTransaction> {
    const response = await this.client.get(`/extended/v1/tx/${txId}/raw`);

    return deserializeTransaction(response.data.raw_tx);
  }

  async getAccountBalance(account: string): Promise<AddressBalanceResponse> {
    const response = await this.client.get(`/extended/v1/address/${account}/balances`);

    return response.data as AddressBalanceResponse;
  }

  async getContractInfo(contractId: string): Promise<ContractInfoResponse> {
    const response = await this.client.get(`/extended/v1/contract/${contractId}`);

    const data = response.data;

    const abi = JSON.parse(data.abi || '');

    return {
      ...data,
      abi,
    };
  }

  async getContractEvents(contractId: string, offset: number, limit: number): Promise<ScEvent[]> {
    const response = await this.client.get(`/extended/v1/contract/${contractId}/events`, {
      params: {
        offset,
        limit,
      },
    });
    const results = response.data?.results ?? [];
    return mapRawEventsToSmartContractEvents(results);
  }

  async getNextNonce(address: string): Promise<number> {
    const response = await this.client.get(`/extended/v1/address/${address}/nonces`);
    const data = response.data;

    if (data.detected_missing_nonces.length > 0) {
      return data.detected_missing_nonces[data.detected_missing_nonces.length - 1];
    }

    return data.possible_next_nonce;
  }

  async getBlock(blockHeight: number): Promise<Buffer> {
    const response = await this.client.get(`/v3/blocks/height/${blockHeight}`, {
      responseType: 'arraybuffer',
    });
    return response.data;
  }
}
