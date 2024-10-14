import { Injectable } from '@nestjs/common';
import { OperationResponse, Transaction } from '@stacks/blockchain-api-client/src/types';
import axios from 'axios';
import { ApiConfigService } from '../config';

export type AddressBalanceResponse = OperationResponse['get_account_balance']; // This is missing from the SDK so we import it manually

@Injectable()
export class HiroApiHelper {
  private readonly hiroUrl: string;

  constructor(apiConfigService: ApiConfigService) {
    this.hiroUrl = apiConfigService.getHiroApiUrl();
  }

  async getTransactionWithFee(txHash: string): Promise<{ transaction: Transaction; fee: string }> {
    const response = await axios.get(`${this.hiroUrl}/extended/v1/tx/${txHash}`);
    const transaction = response.data as Transaction;

    return { transaction, fee: transaction.fee_rate };
  }

  async getAccountBalance(account: string): Promise<AddressBalanceResponse> {
    const response = await axios.get(`${this.hiroUrl}/extended/v1/address/${account}`);
    const balance = response.data as AddressBalanceResponse;
    return balance;
  }
}
